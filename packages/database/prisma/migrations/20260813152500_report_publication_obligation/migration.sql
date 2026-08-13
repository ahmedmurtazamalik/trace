ALTER TABLE "reports"
ADD COLUMN "published_at" TIMESTAMP(3);

CREATE INDEX "reports_status_published_at_created_at_idx"
ON "reports"("status", "published_at", "created_at");
