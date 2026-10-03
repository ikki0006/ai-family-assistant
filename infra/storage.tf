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

# Apply the consumer after deploying a Worker version that exports queue().

resource "cloudflare_queue_consumer" "generation" {
  account_id        = var.account_id
  queue_id          = cloudflare_queue.jobs.id
  type              = "worker"
  script_name       = cloudflare_worker.bot.name
  dead_letter_queue = cloudflare_queue.dead_letter.queue_name
  settings = {
    batch_size       = 1
    max_wait_time_ms = 0
    max_retries      = 0
    max_concurrency  = 2
  }
}
