ALTER TABLE "github_webhook_deliveries"
ADD COLUMN "payload" JSONB;

UPDATE "github_webhook_deliveries"
SET
  "payload" = '{}'::JSONB,
  "status" = 'failed',
  "processed_at" = COALESCE("processed_at", CURRENT_TIMESTAMP),
  "processing_error" = 'WEBHOOK_PAYLOAD_UNAVAILABLE'
WHERE "payload" IS NULL;

ALTER TABLE "github_webhook_deliveries"
ALTER COLUMN "payload" SET NOT NULL;

ALTER TABLE "github_webhook_deliveries"
ADD COLUMN "published_at" TIMESTAMP(3);

CREATE INDEX "github_webhook_deliveries_status_published_at_received_at_idx"
ON "github_webhook_deliveries"("status", "published_at", "received_at");
