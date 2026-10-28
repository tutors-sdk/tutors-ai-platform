# Infrastructure

Everything needed to run the platform, as code: another institution should be able to stand
staging up from this repository alone.

```
infra/
  aws/                    Terraform: VPC, ROSA HCP cluster, CPU and GPU machine pools, EFS
  openshift/
    base/                 inference-api, insights-worker, ollama, postgres, otel-collector,
                          model-pin, course-exports, network policies, monitoring (observability.yaml)
    overlays/staging/     tutors-ai-staging: synthetic learners only, smaller sizes, images from main
    overlays/production/  tutors-ai-production: promoted tags, pinned model digest
    pin-model.sh          pulls the model in a namespace and pins its digest
  ci/
    check.sh              the infrastructure gate
    policy/               conftest (Rego) policies and their tests
```

## Stand up staging

1. **A cluster.** `infra/aws` creates one (see its README for apply order and the GPU and EFS
   setup). Any OpenShift 4.17+ cluster works if it has a node labelled
   `nvidia.com/gpu.present=true` and tainted `nvidia.com/gpu`, the NVIDIA GPU Operator, and a
   ReadWriteMany class named `efs-sc` (or patch `course-exports` to another).
2. **Namespace and secret.** The secret is applied by hand so no credential is ever committed:
   ```sh
   oc apply -f infra/openshift/overlays/staging/namespace.yaml
   cp infra/openshift/overlays/staging/secret.example.yaml infra/openshift/overlays/staging/secret.yaml
   # edit secret.yaml: replace CHANGE_ME in password and url (secret.yaml is git-ignored)
   oc apply -f infra/openshift/overlays/staging/secret.yaml
   ```
3. **Everything else.** `oc apply -k infra/openshift/overlays/staging`
4. **The model.** `infra/openshift/pin-model.sh tutors-ai-staging --record staging` pulls the
   model in `model-pin`, reads its digest from Ollama's `/api/tags`, patches the ConfigMap,
   restarts the API and records the digest in the overlay. Commit that change. Until this step
   runs, `inference-api` exits at start with "OLLAMA_DIGEST must be a sha256 digest": it never
   serves a model it cannot name by digest.
5. **Synthetic course exports.** Until the monorepo's export job writes them, copy the fixtures in:
   ```sh
   oc -n tutors-ai-staging run exports-loader --image=registry.access.redhat.com/ubi9/ubi:9.4 \
     --restart=Never --overrides='{"spec":{"containers":[{"name":"exports-loader","image":"registry.access.redhat.com/ubi9/ubi:9.4","command":["sleep","600"],"volumeMounts":[{"name":"exports","mountPath":"/course-exports"}]}],"volumes":[{"name":"exports","persistentVolumeClaim":{"claimName":"course-exports"}}]}}'
   oc -n tutors-ai-staging wait --for=condition=Ready pod/exports-loader
   for f in packages/adapters/course-content/test/fixtures/*.json; do
     oc -n tutors-ai-staging cp "$f" "exports-loader:/course-exports/$(basename "$f")"
   done
   oc -n tutors-ai-staging delete pod exports-loader
   ```

The inference API is reachable only from inside its namespace until authentication lands (ADR
0005); use `oc -n tutors-ai-staging port-forward svc/inference-api 8080` to try it.

## Environment flow

| Step | What happens |
| --- | --- |
| Pull request | CI runs `pnpm check` and the `infra` job: `check.sh staging` strictly, and production with `--expect-unpinned` until production is pinned. |
| Merge to main | CI builds the two images and pushes them to `quay.io/tutors-sdk` (the `QUAY_ORG` repository variable) as `main` and `sha-<commit>`, using the `QUAY_ROBOT_USERNAME` and `QUAY_ROBOT_TOKEN` secrets, sets the staging overlay's tags to `sha-<commit>` in its working copy, and runs `oc apply -k overlays/staging` with a service account that can edit `tutors-ai-staging` only. |
| Production | Manual promotion only. A pull request sets the production overlay's image tags to ones that passed staging and records the staging-evaluated digest (`pin-model.sh tutors-ai-staging --record production`). After merge, a named operator runs `oc apply -k overlays/production` and `pin-model.sh tutors-ai-production`, which refuses if the weights Ollama pulls differ from the recorded digest. |

## Isolation rules

- **Two namespaces, nothing shared but the GPU node.** Each environment has its own PostgreSQL,
  Ollama, collector, volumes and secret. Production and staging passwords differ.
- **Staging holds synthetic learners only.** Its namespace and every resource carry
  `tutors-ai/data: synthetic-learners-only`; real student data must never be loaded there.
- **Default deny.** All ingress is denied, then exactly four flows are allowed:
  `inference-api -> ollama:11434`, `inference-api, insights-worker -> postgres:5432` and
  `inference-api, insights-worker -> otel-collector:4318`, each from pods in the same namespace
  only, and OpenShift user workload monitoring to `otel-collector:8889` for metrics. Nothing else
  may reach Ollama.
- **Observed.** A ServiceMonitor scrapes the collector and a PrometheusRule alerts on port errors
  and slow requests (`base/observability.yaml`, `docs/observability.md`).
- **Nothing exposed.** No Route, Ingress, LoadBalancer or NodePort until authentication lands
  (ADR 0005). There is no router allowance in the network policies for the same reason.
- **Locked-down containers.** Non-root, no privilege escalation, all capabilities dropped,
  read-only root filesystem, resource limits, and no `latest` images.
- **Named weights.** Production serves only a model named by a real sha256 digest (ADR 0003).
- **The API's egress is limited.** It reaches tool servers (ADR 0008), so it may reach only DNS,
  Ollama, PostgreSQL, the collector and pods labelled `tutors-ai/tool-server: "true"`. A tool
  server outside the cluster needs an overlay rule naming its address range; nothing may open the
  API's egress to everywhere. Tool servers are listed in the `tool-servers` ConfigMap and their
  tokens kept in the `tool-server-tokens` Secret, applied by hand like `postgres-app`.
- Other egress is not restricted yet: Ollama pulls weights from its registry, and nodes pull
  images through the NAT gateway.

`check.sh` enforces the exposure, container, Ollama network, API egress, tool token and production pin rules on every
pull request; the policies are in `ci/policy/`, each with tests.

## Running the check locally

Needs [kustomize](https://github.com/kubernetes-sigs/kustomize) 5.4+,
[kubeconform](https://github.com/yannh/kubeconform) 0.6+,
[conftest](https://github.com/open-policy-agent/conftest) 0.56+ and, optionally, Terraform 1.6+.

```sh
infra/ci/check.sh staging                                       # strict
infra/ci/check.sh --skip-terraform --expect-unpinned production  # until production is pinned
```
