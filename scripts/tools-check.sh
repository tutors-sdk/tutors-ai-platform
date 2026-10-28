#!/usr/bin/env bash
# The tool path end to end against the running compose stack (scripts/dev-up.sh first), as ADR 0008
# lays it out, using the operator's tool command inside the API's container:
#
#   1. The API lists the stand-in server's tools over MCP with its token, and a call through the
#      harness answers and is audited in PostgreSQL.
#   2. A tool that is not read-only is excluded and never called.
#   3. The tool server stopped: the call fails as unavailable within its timeout, and the API stays
#      ready and is not restarted. The server back: calls answer again.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${COMPOSE:-}" ]; then
  if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="podman compose"; fi
fi
API=http://127.0.0.1:8080
STUB=http://127.0.0.1:8090

fail() { echo "TOOLS FAILED: $*" >&2; $COMPOSE logs --no-color --tail 40 tool-stub inference-api >&2; exit 1; }
tools() { $COMPOSE exec -T inference-api node /opt/app/tools.mjs "$@"; }
audited() {
  $COMPOSE exec -T postgres psql -U tutors -d tutors_ai -tAc \
    "select count(*) from tool_calls where learner_id = 'operator-check' and outcome = '$1'"
}
api_restarts() { docker inspect -f '{{.RestartCount}} {{.State.Running}}' "$($COMPOSE ps -q inference-api)"; }
lookup='{"term":"loop"}'

echo "== 1. The stub's tools, through the harness"
listing=$(tools list stub) || fail "listing the stub's tools failed: $listing"
echo "$listing"
grep -q '"tool":"glossary_lookup"' <<<"$listing" || fail "the listing has no glossary_lookup"
before=$(audited result)
out=$(tools check stub glossary_lookup "$lookup") || fail "the check call failed: $out"
echo "$out"
grep -q '"kind":"result"' <<<"$out" || fail "the check call did not answer"
[ "$(audited result)" -gt "$before" ] || fail "the call was not audited in PostgreSQL"

echo "== 2. A tool that is not read-only"
code=0
out=$(tools check stub record_grade '{"learner":"x","grade":1}') || code=$?
[ "$code" = 1 ] && grep -q '"not-read-only"' <<<"$out" || fail "record_grade was not excluded as not read-only: $out"

echo "== 3. The tool server stopped"
restarts=$(api_restarts)
$COMPOSE stop tool-stub
started=$(date +%s)
code=0
out=$(tools check stub glossary_lookup "$lookup") || code=$?
took=$(( $(date +%s) - started ))
[ "$code" = 1 ] && grep -q '"error":"unavailable"' <<<"$out" || fail "expected the stopped server to be unavailable, got: $out"
[ "$took" -lt 20 ] || fail "the failed call took ${took}s; it should be bounded by its timeout"
echo "unavailable in ${took}s"
curl -sf "$API/readyz" >/dev/null || fail "the API is not ready while a tool server is down"

$COMPOSE start tool-stub
for _ in $(seq 1 30); do curl -sf "$STUB/healthz" >/dev/null && break; sleep 1; done
out=$(tools check stub glossary_lookup "$lookup") || fail "the check call failed after the server came back: $out"
[ "$(api_restarts)" = "$restarts" ] || fail "the API process restarted or stopped (was '$restarts', now '$(api_restarts)')"
echo "the server is back and calls answer; the API was not restarted"
echo "TOOLS PASSED"
