output "cluster_id" {
  description = "ROSA cluster id, for `rosa` and OpenShift Cluster Manager."
  value       = rhcs_cluster_rosa_hcp.this.id
}

output "api_url" {
  description = "API server; log in with `oc login <api_url> -u cluster-admin`."
  value       = rhcs_cluster_rosa_hcp.this.api_url
}

output "console_url" {
  value = rhcs_cluster_rosa_hcp.this.console_url
}

output "cluster_admin_password" {
  description = "Initial cluster-admin password. Replace with an identity provider, then delete the user."
  value       = rhcs_cluster_rosa_hcp.this.admin_credentials.password
  sensitive   = true
}

output "efs_file_system_id" {
  description = "File system for the efs-sc StorageClass (course-exports)."
  value       = aws_efs_file_system.course_exports.id
}

output "oidc_endpoint_url" {
  description = "Needed when creating the EFS CSI driver's IAM role."
  value       = local.oidc_endpoint
}
