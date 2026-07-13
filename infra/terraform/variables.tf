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
