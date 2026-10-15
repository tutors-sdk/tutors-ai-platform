# ROSA with hosted control planes. Red Hat runs the three control-plane nodes in its own account;
# this account holds only the workers: two CPU nodes in the default pool and one GPU node in its
# own tainted pool, which staging and production share.

resource "rhcs_cluster_rosa_hcp" "this" {
  name               = var.cluster_name
  cloud_region       = var.region
  aws_account_id     = data.aws_caller_identity.current.account_id
  aws_subnet_ids     = concat(aws_subnet.private[*].id, aws_subnet.public[*].id)
  availability_zones = local.azs
  machine_cidr       = var.vpc_cidr
  version            = var.openshift_version
  channel_group      = "stable"

  # Default machine pool: two CPU workers, one per private subnet.
  compute_machine_type = var.worker_instance_type
  replicas             = 2

  properties = {
    rosa_creator_arn = data.aws_caller_identity.current.arn
  }

  sts = {
    role_arn             = aws_iam_role.account["installer"].arn
    support_role_arn     = aws_iam_role.account["support"].arn
    instance_iam_roles   = { worker_role_arn = aws_iam_role.account["instance_worker"].arn }
    oidc_config_id       = rhcs_rosa_oidc_config.this.id
    operator_role_prefix = var.cluster_name
  }

  create_admin_user                   = true
  wait_for_create_complete            = true
  wait_for_std_compute_nodes_complete = true

  tags = local.tags

  depends_on = [
    aws_iam_role_policy_attachment.account,
    aws_iam_role_policy_attachment.operator,
    aws_route.private_nat,
  ]
}

# The GPU node. Its label is what the ollama Deployment selects; its taint keeps everything else
# off it. The NVIDIA GPU Operator sets nvidia.com/gpu.present too; setting it here means the
# selector works from the first boot.
resource "rhcs_hcp_machine_pool" "gpu" {
  cluster     = rhcs_cluster_rosa_hcp.this.id
  name        = "gpu"
  subnet_id   = aws_subnet.private[0].id
  replicas    = 1
  auto_repair = true

  autoscaling = {
    enabled = false
  }

  aws_node_pool = {
    instance_type = var.gpu_instance_type
    disk_size     = var.gpu_disk_size
    tags          = local.tags
  }

  labels = {
    "nvidia.com/gpu.present" = "true"
    "tutors-ai/pool"         = "gpu"
  }

  taints = [{
    key           = "nvidia.com/gpu"
    value         = "true"
    schedule_type = "NoSchedule"
  }]
}
