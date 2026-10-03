output "webhook_url" {
  value = "https://${cloudflare_worker.bot.name}.${var.workers_subdomain}.workers.dev/webhooks/line"
}

output "database_id" {
  value = cloudflare_d1_database.family.id
}

output "database_name" {
  value = cloudflare_d1_database.family.name
}

output "jobs_queue_name" {
  value = cloudflare_queue.jobs.queue_name
}

output "dead_letter_queue_name" {
  value = cloudflare_queue.dead_letter.queue_name
}
