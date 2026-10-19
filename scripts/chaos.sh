#!/usr/bin/env bash
# Chaos against the running compose stack (scripts/dev-up.sh first): takes Ollama and then
# PostgreSQL away and checks the API degrades and recovers the way ADR 0007 says.
#
#   1. Ollama stopped: assist requests come back at once as "model-unavailable" refusals, the
#      circuit opens after MODEL_CIRCUIT_FAILURES of them, and the next refusal does not wait.
#   2. Ollama back: after MODEL_CIRCUIT_RESET_MS a probe closes the circuit and answers resume.
#   3. PostgreSQL restarted: the API process survives, /readyz goes 503 then 200 again, and
#      evidence is recorded once the database is back.
#
# CI runs it with MODEL_CIRCUIT_FAILURES=2 and MODEL_CIRCUIT_RESET_MS=5000 (see ci.yml).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${COMPOSE:-}" ]; then
  if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="podman compose"; fi
fi
API=http://127.0.0.1:8080
failures=${MODEL_CIRCUIT_FAILURES:-5}
reset_ms=${MODEL_CIRCUIT_RESET_MS:-30000}

fail() { echo "CHAOS FAILED: $*" >&2; $COMPOSE logs --no-color --tail 80 inference-api >&2; exit 1; }

assist() {
  curl -s --max-time 180 -o assist.json -w '%{http_code} %{time_total}\n' "$API/v0/assist" -H 'content-type: application/json' -d '{
    "contractVersion": "0.1.0",
    "learner": {"learnerId": "chaos-learner", "sessionId": "chaos-session", "courseId": "full-stack-1",
                "labId": "lab-01-loops", "level": "first-year", "memory": {"kind": "session", "sharing": "private"}},
    "question": "Why does my while loop never end?"
  }'
}
reason() { node -e 'const b = JSON.parse(require("fs").readFileSync("assist.json", "utf8")); console.log(b.kind === "refused" ? b.reason : b.kind)'; }
# Read the log whole: under pipefail, grep -q closing a pipe early fails the logs command.
api_log() { $COMPOSE logs --no-color inference-api 2>&1; }
api_restarts() { docker inspect -f '{{.RestartCount}} {{.State.Running}}' "$($COMPOSE ps -q inference-api)"; }

before=$(api_restarts)

echo "== 1. Ollama stopped"
$COMPOSE stop ollama
for i in $(seq 1 $((failures + 1))); do
  read -r code seconds < <(assist)
  [ "$code" = 200 ] || fail "assist answered HTTP $code with Ollama down"
  [ "$(reason)" = model-unavailable ] || fail "expected a model-unavailable refusal, got $(reason)"
  echo "request $i: refused model-unavailable in ${seconds}s"
done
awk -v s="$seconds" 'BEGIN { exit !(s < 1.0) }' || fail "the refusal after the circuit opened took ${seconds}s; it should fail fast"
grep -q '"msg":"model resilience","type":"circuit","from":"closed","to":"open"' <<<"$(api_log)" || fail "no log line for the circuit opening"

echo "== 2. Ollama back"
$COMPOSE start ollama
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:11434/api/version >/dev/null && break; sleep 1; done
sleep $(( (reset_ms + 999) / 1000 ))
recovered=
for _ in $(seq 1 10); do
  read -r code seconds < <(assist)
  if [ "$code" = 200 ] && [ "$(reason)" != model-unavailable ]; then recovered=yes; break; fi
  sleep $(( (reset_ms + 999) / 1000 ))
done
[ -n "$recovered" ] || fail "assist still refused as model-unavailable after Ollama came back"
echo "assist answered ($(reason)) in ${seconds}s"
grep -q '"type":"circuit","from":"half-open","to":"closed"' <<<"$(api_log)" || fail "no log line for the circuit closing"

echo "== 3. PostgreSQL restarted"
$COMPOSE restart postgres
saw_not_ready=
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$API/readyz" || true)
  [ "$code" = 503 ] && saw_not_ready=yes
  [ "$code" = 200 ] && [ -n "$saw_not_ready" ] && break
  [ "$code" = 200 ] && $COMPOSE exec -T postgres pg_isready -q -U tutors -d tutors_ai && break
  sleep 1
done
[ "$code" = 200 ] || fail "/readyz did not recover after PostgreSQL restarted (last $code)"
[ "$(api_restarts)" = "$before" ] || fail "the API process restarted or stopped (was '$before', now '$(api_restarts)')"
evidence=$(curl -s -o /dev/null -w '%{http_code}' "$API/v0/evidence" -H 'content-type: application/json' -d "{
  \"contractVersion\": \"0.1.0\", \"type\": \"lab-opened\", \"learnerId\": \"chaos-learner\", \"sessionId\": \"chaos-session\",
  \"courseId\": \"full-stack-1\", \"observedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"source\": \"chaos\", \"confidence\": 1, \"retention\": \"session\"
}")
[ "$evidence" = 201 ] || fail "evidence answered HTTP $evidence after PostgreSQL came back"
echo "API survived the restart; /readyz is 200 and evidence is recorded"
echo "CHAOS PASSED"
