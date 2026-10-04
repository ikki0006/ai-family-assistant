# Inference budget only; infrastructure, tax and FX are outside this USD limit.
# Keep headroom against the household's JPY 10,000 total monthly target.
resource "cloudflare_ai_gateway" "family" {
  account_id                 = var.account_id
  id                         = var.worker_name
  authentication             = true
  cache_invalidate_on_update = true
  cache_ttl                  = 0
  collect_logs               = false
  logpush                    = false
  workers_ai_billing_mode    = "postpaid"
  byok_only                  = true
  rate_limiting_interval     = 60
  rate_limiting_limit        = 10
  rate_limiting_technique    = "sliding"
  retry_max_attempts         = null
  spend_limits = {
    enabled = true
    rules = [
      {
        id         = "family-month"
        enabled    = true
        limit      = 40
        limit_type = "cost"
        technique  = "sliding"
        window     = 2678400 # 31 days; shared across reply and summarization requests.
      },
      {
        id         = "family-day"
        enabled    = true
        limit      = 2
        limit_type = "cost"
        technique  = "sliding"
        window     = 86400
      }
    ]
  }
}
