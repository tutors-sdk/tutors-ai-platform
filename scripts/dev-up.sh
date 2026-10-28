#!/usr/bin/env bash
# Starts the whole platform locally (compose.yaml): PostgreSQL, Ollama, the collector, the stand-in
# tool server and the inference API. Pulls the model, pins its digest in .env (the API serves only
# a model it can name by digest), then builds and starts the API and waits until it is ready.
#
#   scripts/dev-up.sh                    # qwen2.5:0.5b, small enough for a laptop CPU
#   OLLAMA_MODEL=qwen3.8:27b scripts/dev-up.sh
#   COMPOSE="podman compose" scripts/dev-up.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${COMPOSE:-}" ]; then
  if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"
  elif podman compose version >/dev/null 2>&1; then COMPOSE="podman compose"
  else echo "Neither 'docker compose' nor 'podman compose' is available" >&2; exit 1; fi
fi
model="${OLLAMA_MODEL:-$(sed -n 's/^OLLAMA_MODEL=//p' .env 2>/dev/null | tail -1)}"
model="${model:-qwen2.5:0.5b}"

$COMPOSE up -d postgres ollama otel-collector
for _ in $(seq 1 60); do
  $COMPOSE exec -T postgres pg_isready -q -U tutors -d tutors_ai 2>/dev/null \
    && curl -sf http://127.0.0.1:11434/api/version >/dev/null && break
  sleep 2
done

echo "Pulling $model (first run downloads the weights)"
$COMPOSE exec -T ollama ollama pull "$model"
digest=$(curl -sf http://127.0.0.1:11434/api/tags | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const m = JSON.parse(s).models.find((m) => m.name === process.argv[1]);
    if (!m) process.exit(1);
    console.log("sha256:" + m.digest);
  });' "$model")
echo "$model is $digest"

# Keep whatever else .env holds; replace only the two model lines.
touch .env
grep -v '^OLLAMA_MODEL=\|^OLLAMA_DIGEST=' .env > .env.tmp || true
printf 'OLLAMA_MODEL=%s\nOLLAMA_DIGEST=%s\n' "$model" "$digest" >> .env.tmp
mv .env.tmp .env

$COMPOSE up -d --build tool-stub inference-api
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8080/readyz >/dev/null; then
    echo "inference-api is ready on http://127.0.0.1:8080"
    exit 0
  fi
  sleep 2
done
echo "inference-api did not become ready; its log:" >&2
$COMPOSE logs inference-api >&2
exit 1
