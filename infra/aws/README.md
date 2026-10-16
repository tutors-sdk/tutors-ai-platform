# AWS: one ROSA HCP cluster

Terraform for the cluster both environments run on: a VPC, the STS roles ROSA needs, a ROSA cluster
with hosted control planes, and the EFS file system for course exports.

| What | Where it runs |
| --- | --- |
| Control plane: API server, etcd, controllers on **three control-plane nodes across zones** | Red Hat's account. ROSA HCP manages and bills it; there are no control-plane or infra nodes in this account and nothing here sizes them. |
| Default machine pool: **2 CPU workers**, one per private subnet | This account, `worker_instance_type` |
| `gpu` machine pool: **1 GPU node**, label `nvidia.com/gpu.present=true`, taint `nvidia.com/gpu=true:NoSchedule` | This account, `gpu_instance_type`. Shared by staging and production; nothing else tolerates the taint. |
| Storage | `gp3-csi` (ROSA's default class) for PostgreSQL and model volumes; EFS (`efs-sc`) for the ReadWriteMany `course-exports` claim |

Region and instance types have no defaults: the design leaves sizes to this phase. The GPU node
must give each environment its own GPU: an instance with two GPUs, or one GPU shared with NVIDIA
time-slicing, in which case its memory must hold both environments' copies of the model.

## Prerequisites

- An AWS account with ROSA enabled and linked to a Red Hat account (`rosa verify quota`, `rosa whoami`).
- AWS credentials for that account, and `RHCS_TOKEN` set to an OpenShift Cluster Manager token
  from https://console.redhat.com/openshift/token/rosa.
- Terraform 1.6 or newer, `oc`, and an S3 bucket for state.

## Apply order

Everything is one `terraform apply`; dependencies run in this order:

1. **VPC**: two private and two public subnets, internet and NAT gateways.
2. **IAM**: the installer, support and worker account roles; a Red Hat managed OIDC configuration
   and its IAM provider; one operator role per cluster operator. All use AWS managed ROSA policies.
3. **Cluster**: `rhcs_cluster_rosa_hcp` with the default pool of two CPU workers. Allow 15 to 30 minutes.
4. **GPU pool** and **EFS** (EFS needs only the VPC and may finish earlier).

```sh
cd infra/aws
cp terraform.tfvars.example terraform.tfvars   # set region and instance types
terraform init -backend-config="bucket=<state-bucket>" -backend-config="key=tutors-ai/terraform.tfstate" -backend-config="region=<region>"
terraform apply
oc login "$(terraform output -raw api_url)" -u cluster-admin -p "$(terraform output -raw cluster_admin_password)"
```

Then, once per cluster, before the first `oc apply -k`:

1. **GPU**: install the Node Feature Discovery and NVIDIA GPU operators from OperatorHub and
   create their default `NodeFeatureDiscovery` and `ClusterPolicy`. Configure time-slicing in the
   `ClusterPolicy` device plugin if the GPU node has a single GPU.
2. **EFS**: install the AWS EFS CSI Driver Operator with an STS role (Red Hat's "Setting up the
   AWS EFS CSI Driver Operator" for ROSA; `terraform output oidc_endpoint_url` gives the trust
   issuer), create its `ClusterCSIDriver`, then the class the course-exports claim names:

   ```yaml
   apiVersion: storage.k8s.io/v1
   kind: StorageClass
   metadata:
     name: efs-sc
   provisioner: efs.csi.aws.com
   parameters:
     provisioningMode: efs-ap
     fileSystemId: <terraform output efs_file_system_id>
     directoryPerms: "700"
   ```

3. Replace the `cluster-admin` user with an identity provider.

Then follow [`../README.md`](../README.md) to stand up staging.

## Notes

- Workers sit in private subnets; the API endpoint and the console's default router are public.
  The platform itself publishes nothing (ADR 0005).
- Providers are pinned exactly in `versions.tf`. Commit a lock file covering the platforms you
  use: `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`.
- `terraform destroy` removes the GPU pool, the cluster, then the roles, EFS and the VPC. Delete
  the two namespaces first so their volumes are released.
