variable "aws_region" {
  type    = string
  default = "ap-east-1"
}
variable "environment" {
  type    = string
  default = "production"
}
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
variable "api_image" { type = string }
variable "worker_image" { type = string }
variable "temporal_address" { type = string }
variable "temporal_namespace" { type = string }
variable "temporal_api_key_secret_arn" {
  type      = string
  sensitive = true
}
variable "otel_exporter_otlp_endpoint" { type = string }
variable "otel_headers_secret_arn" {
  type      = string
  sensitive = true
}

variable "api_min_capacity" {
  type    = number
  default = 2
}
variable "api_max_capacity" {
  type    = number
  default = 10
}
variable "worker_min_capacity" {
  type    = number
  default = 2
}
variable "worker_max_capacity" {
  type    = number
  default = 8
}
variable "db_read_replica_instance_class" {
  type    = string
  default = "db.r6g.large"
}
variable "waf_rate_limit_per_5min" {
  description = "Per-IP request budget over a rolling 5 minutes, enforced by AWS WAF in front of the ALB."
  type        = number
  default     = 2000
}
