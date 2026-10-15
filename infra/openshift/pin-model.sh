#!/usr/bin/env bash
# Pull the model named in a namespace's model-pin ConfigMap into its Ollama, read the digest the
# server reports in /api/tags, and pin it: patch the ConfigMap and restart the inference API so it
# picks the digest up (ADR 0003). The digest always comes from the server, never from a guess.
#
#   infra/openshift/pin-model.sh <namespace> [--record <overlay>] [--force]
#
#   --record <overlay>  also write the digest into infra/openshift/overlays/<overlay>/model-pin.yaml,
#                       e.g. pin in staging and record for production, then promote by PR.
#   --force             replace a digest that is already pinned. Without it a different digest
#                       is an error: the tag has moved and the new weights have not been evaluated.
#
# Needs oc (logged in) and jq. Safe to re-run: a pull of a present model is a no-op.
set -euo pipefail

usage() { sed -n '2,13p' "$0" >&2; exit 2; }
[ $# -ge 1 ] || usage
namespace="$1"; shift
record=""
force=false
while [ $# -gt 0 ]; do
  case "$1" in
    --record) [ $# -ge 2 ] || usage; record="$2"; shift 2 ;;
    --force) force=true; shift ;;
    *) usage ;;
  esac
done

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
oc_ns() { oc -n "$namespace" "$@"; }

model="$(oc_ns get configmap model-pin -o jsonpath='{.data.OLLAMA_MODEL}')"
pinned="$(oc_ns get configmap model-pin -o jsonpath='{.data.OLLAMA_DIGEST}')"
[ -n "$model" ] || { echo "pin-model: model-pin has no OLLAMA_MODEL in $namespace" >&2; exit 1; }

echo "Pulling $model in $namespace (this can take a while for 27B weights)"
oc_ns rollout status deployment/ollama --timeout=10m
oc_ns exec deploy/ollama -- ollama pull "$model"

# The image has no curl; ask the server over bash's /dev/tcp and drop the HTTP headers.
tags="$(oc_ns exec deploy/ollama -- bash -c \
  'exec 3<>/dev/tcp/127.0.0.1/11434; printf "GET /api/tags HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3; cat <&3' \
  | tr -d '\r' | sed '1,/^$/d')"
hex="$(jq -r --arg m "$model" '.models[] | select(.name == $m or .model == $m) | .digest' <<<"$tags" | head -n1)"
hex="${hex#sha256:}"
[[ "$hex" =~ ^[0-9a-f]{64}$ ]] || { echo "pin-model: no digest for $model in /api/tags" >&2; exit 1; }
digest="sha256:$hex"

if [ "$pinned" = "$digest" ]; then
  echo "$namespace already pins $model at $digest"
elif [[ "$pinned" =~ ^sha256:[0-9a-f]{64}$ ]] && [ "$force" = false ]; then
  echo "pin-model: $namespace pins $pinned but the server now has $digest for $model." >&2
  echo "The tag has moved. Evaluate the new weights in staging, then re-run with --force." >&2
  exit 1
else
  oc_ns patch configmap model-pin --type merge -p "{\"data\":{\"OLLAMA_DIGEST\":\"$digest\"}}"
  oc_ns rollout restart deployment/inference-api
  echo "Pinned $model at $digest in $namespace"
fi

if [ -n "$record" ]; then
  file="$here/overlays/$record/model-pin.yaml"
  [ -f "$file" ] || { echo "pin-model: $file does not exist" >&2; exit 1; }
  sed -i.bak -E "s|^(  OLLAMA_DIGEST:).*|\1 $digest|" "$file" && rm -f "$file.bak"
  echo "Recorded $digest in ${file#"$here"/}; commit it and promote by pull request."
fi
