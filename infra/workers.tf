resource "cloudflare_worker" "bot" {
  account_id = var.account_id
  name       = var.worker_name

  observability = {
    enabled            = true
    head_sampling_rate = 1
    logs = {
      enabled         = true
      invocation_logs = true
      persist         = true
    }
  }

  # Application versions and secrets are managed outside Terraform.
  subdomain = {
    enabled          = true
    previews_enabled = false
  }
}
