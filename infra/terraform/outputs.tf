output "api_origin" { value = "http://${aws_lb.api.dns_name}" }
output "database_endpoint" { value = aws_db_instance.main.endpoint }
output "database_secret_arn" {
  value     = aws_secretsmanager_secret.database.arn
  sensitive = true
}
output "backup_bucket" { value = aws_s3_bucket.backup.id }
output "slo_dashboard" { value = aws_cloudwatch_dashboard.slo.dashboard_name }
