# Exact provider pins: a plan made today and one made next year use the same code. Bump them
# deliberately, then regenerate the lock file (see README.md).
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.69.0"
    }
    rhcs = {
      source  = "terraform-redhat/rhcs"
      version = "1.7.5"
    }
  }

  # State holds the cluster admin password and role ARNs: keep it in a remote backend, for
  # example an encrypted S3 bucket, configured with `terraform init -backend-config=...`.
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}

# Reads RHCS_TOKEN (an OpenShift Cluster Manager token from console.redhat.com/openshift/token/rosa).
provider "rhcs" {}
