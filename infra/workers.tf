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

# JST 23:00 and 08:00. Additional invocations retry failed sends with the same key.
# Apply after the version exporting scheduled() is deployed.
resource "cloudflare_workers_cron_trigger" "reminders" {
  account_id  = var.account_id
  script_name = cloudflare_worker.bot.name
  schedules   = [{ cron = "0,5,10 14,23 * * *" }]
}
