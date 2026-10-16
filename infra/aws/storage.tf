# Storage classes. ROSA ships gp3-csi as the default class, which the ReadWriteOnce claims use
# (PostgreSQL data, Ollama models). The course-exports claim is ReadWriteMany, because the API
# and the worker mount it from different nodes, so it needs EFS: this file system plus the AWS
# EFS CSI Driver Operator and the `efs-sc` StorageClass described in README.md.

resource "aws_security_group" "efs" {
  name        = "${var.cluster_name}-efs"
  description = "NFS from the cluster VPC to the course-exports file system"
  vpc_id      = aws_vpc.this.id
}

resource "aws_vpc_security_group_ingress_rule" "efs_nfs" {
  security_group_id = aws_security_group.efs.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 2049
  to_port           = 2049
}

resource "aws_efs_file_system" "course_exports" {
  creation_token = "${var.cluster_name}-course-exports"
  encrypted      = true

  tags = { Name = "${var.cluster_name}-course-exports" }
}

resource "aws_efs_mount_target" "course_exports" {
  count           = length(local.azs)
  file_system_id  = aws_efs_file_system.course_exports.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}
