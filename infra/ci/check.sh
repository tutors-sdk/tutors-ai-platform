#!/usr/bin/env bash
# Infrastructure gate: render each overlay, validate it against the Kubernetes schemas, hold it to
# the policies in infra/ci/policy, then check the Terraform.
#
#   infra/ci/check.sh [--expect-unpinned] [--skip-terraform] [overlay ...]
#
# Overlays are names under infra/openshift/overlays (default: staging). With --expect-unpinned,
# every policy must pass except the production model pin, which must fail: that is how CI keeps
# checking production while its digest is still sha256:UNPINNED. Once production is pinned that
# run fails too, as a reminder to drop the flag.
#
# Needs kustomize, kubeconform and conftest on PATH; terraform is optional.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
policy="$root/infra/ci/policy"
k8s_version="${KUBERNETES_VERSION:-1.30.0}" # OpenShift 4.17

expect_unpinned=false
skip_terraform=false
overlays=()
for arg in "$@"; do
  case "$arg" in
    --expect-unpinned) expect_unpinned=true ;;
    --skip-terraform) skip_terraform=true ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) overlays+=("$arg") ;;
  esac
done
[ "${#overlays[@]}" -gt 0 ] || overlays=(staging)

for tool in kustomize kubeconform conftest; do
  command -v "$tool" >/dev/null || { echo "check: $tool is not on PATH" >&2; exit 2; }
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "== policy unit tests"
conftest verify --policy "$policy"

for overlay in "${overlays[@]}"; do
  dir="$root/infra/openshift/overlays/$overlay"
  [ -d "$dir" ] || { echo "check: no overlay $overlay" >&2; exit 2; }
  rendered="$work/$overlay.yaml"

  echo "== $overlay: kustomize build"
  kustomize build "$dir" >"$rendered"

  echo "== $overlay: kubeconform"
  kubeconform -strict -ignore-missing-schemas -kubernetes-version "$k8s_version" -summary "$rendered"

  echo "== $overlay: conftest"
  if [ "$expect_unpinned" = false ]; then
    conftest test --combine --policy "$policy" --all-namespaces "$rendered"
  else
    conftest test --combine --policy "$policy" --namespace main "$rendered"
    if conftest test --combine --policy "$policy" --namespace pin "$rendered"; then
      echo "check: $overlay is pinned now; drop --expect-unpinned for it" >&2
      exit 1
    fi
    echo "(expected: $overlay model pin is not set yet)"
  fi
done

if [ "$skip_terraform" = true ]; then
  echo "== terraform: skipped (--skip-terraform)"
elif ! command -v terraform >/dev/null; then
  echo "== terraform: not installed, skipping fmt and validate"
else
  echo "== terraform: fmt and validate"
  terraform -chdir="$root/infra/aws" fmt -check -recursive -diff
  terraform -chdir="$root/infra/aws" init -backend=false -input=false >/dev/null
  terraform -chdir="$root/infra/aws" validate
fi

echo "infra check passed: ${overlays[*]}"
