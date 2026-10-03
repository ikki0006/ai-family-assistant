variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "worker_name" {
  description = "Worker name (keep in sync with wrangler.jsonc)"
  type        = string
  default     = "ai-family-assistant"
}

variable "workers_subdomain" {
  description = "Existing account subdomain, without .workers.dev"
  type        = string
}
