# Sizes and region have no defaults on purpose: the design leaves them to this phase, and a
# silent default would decide them. See terraform.tfvars.example.

variable "region" {
  description = "AWS region for the cluster, for example eu-west-1. Must offer ROSA HCP and the GPU instance type."
  type        = string
}

variable "worker_instance_type" {
  description = "Instance type of the two CPU workers in the default machine pool."
  type        = string
}

variable "gpu_instance_type" {
  description = "Instance type of the single GPU node. Staging and production each schedule one GPU on it, so it needs two GPUs or NVIDIA time-slicing."
  type        = string
}

variable "cluster_name" {
  description = "Cluster name; also the prefix of its IAM roles. At most 15 characters keeps role names within AWS limits."
  type        = string
  default     = "tutors-ai"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,14}$", var.cluster_name))
    error_message = "Use lower-case letters, digits and hyphens, at most 15 characters, starting with a letter."
  }
}

variable "openshift_version" {
  description = "OpenShift version, for example from `rosa list versions --hosted-cp`. Null takes the channel's latest at creation; pin it for anything you want to reproduce."
  type        = string
  default     = null
}

variable "vpc_cidr" {
  description = "VPC address range; also the cluster's machine CIDR."
  type        = string
  default     = "10.0.0.0/16"
}

variable "gpu_disk_size" {
  description = "Root disk of the GPU node in GiB. GPU driver and CUDA images are large; model weights live on a PVC, not here."
  type        = number
  default     = 300
}

variable "tags" {
  description = "Extra tags for every AWS resource."
  type        = map(string)
  default     = {}
}
