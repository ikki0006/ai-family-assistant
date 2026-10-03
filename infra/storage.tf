resource "cloudflare_d1_database" "family" {
  account_id            = var.account_id
  name                  = "${var.worker_name}-db"
  primary_location_hint = "apac"
  read_replication = {
    mode = "disabled"
  }
}

resource "cloudflare_queue" "jobs" {
  account_id = var.account_id
  queue_name = "${var.worker_name}-jobs"
}

resource "cloudflare_queue" "dead_letter" {
  account_id = var.account_id
  queue_name = "${var.worker_name}-dlq"
}

# Consumer + DLQ routing will be added with the job handler.
# No messages are published by the current ping/pong application.
