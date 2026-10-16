# The STS roles ROSA HCP needs, using the AWS managed ROSA policies that the rhcs provider names:
# three account roles (installer, support, worker), a Red Hat managed OIDC configuration, and one
# operator role per cluster operator, trusted only through that OIDC provider.

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "rhcs_info" "current" {}

data "rhcs_hcp_policies" "all" {}

locals {
  account_role_prefix = var.cluster_name
  account_policies    = data.rhcs_hcp_policies.all.account_role_policies

  account_roles = {
    installer = {
      name      = "${local.account_role_prefix}-HCP-ROSA-Installer-Role"
      principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${data.rhcs_info.current.ocm_aws_account_id}:role/RH-Managed-OpenShift-Installer" }
      policy    = local.account_policies.sts_hcp_installer_permission_policy
    }
    support = {
      name      = "${local.account_role_prefix}-HCP-ROSA-Support-Role"
      principal = { AWS = local.account_policies.sts_support_rh_sre_role }
      policy    = local.account_policies.sts_hcp_support_permission_policy
    }
    instance_worker = {
      name      = "${local.account_role_prefix}-HCP-ROSA-Worker-Role"
      principal = { Service = "ec2.amazonaws.com" }
      policy    = local.account_policies.sts_hcp_instance_worker_permission_policy
    }
  }

  # Operator role name -> the managed policy it takes, by the provider's policy key.
  operator_policy = { for role in data.rhcs_rosa_hcp_operator_roles.this.operator_iam_roles : role.role_name => role.policy_name }

  oidc_endpoint = trimprefix(rhcs_rosa_oidc_config.this.oidc_endpoint_url, "https://")
}

resource "aws_iam_role" "account" {
  for_each = local.account_roles

  name = each.value.name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = each.value.principal
    }]
  })

  tags = {
    red-hat-managed       = "true"
    rosa_hcp_policies     = "true"
    rosa_managed_policies = "true"
    rosa_role_prefix      = local.account_role_prefix
    rosa_role_type        = each.key
  }
}

resource "aws_iam_role_policy_attachment" "account" {
  for_each = local.account_roles

  role       = aws_iam_role.account[each.key].name
  policy_arn = each.value.policy
}

resource "rhcs_rosa_oidc_config" "this" {
  managed = true
}

resource "aws_iam_openid_connect_provider" "this" {
  url             = "https://${local.oidc_endpoint}"
  client_id_list  = ["openshift", "sts.amazonaws.com"]
  thumbprint_list = [rhcs_rosa_oidc_config.this.thumbprint]
}

data "rhcs_rosa_hcp_operator_roles" "this" {
  operator_role_prefix = var.cluster_name
  account_role_prefix  = local.account_role_prefix
}

resource "aws_iam_role" "operator" {
  for_each = { for role in data.rhcs_rosa_hcp_operator_roles.this.operator_iam_roles : role.role_name => role }

  name = each.key
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.this.arn }
      Condition = {
        StringEquals = { "${local.oidc_endpoint}:sub" = each.value.service_accounts }
      }
    }]
  })

  tags = {
    red-hat-managed       = "true"
    rosa_hcp_policies     = "true"
    rosa_managed_policies = "true"
    operator_namespace    = each.value.operator_namespace
    operator_name         = each.value.operator_name
  }
}

resource "aws_iam_role_policy_attachment" "operator" {
  for_each = aws_iam_role.operator

  role       = each.value.name
  policy_arn = data.rhcs_hcp_policies.all.operator_role_policies[local.operator_policy[each.key]]
}
