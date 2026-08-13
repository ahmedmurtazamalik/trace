ALTER TABLE "reports"
ADD COLUMN "processing_token" TEXT,
ADD COLUMN "processing_expires_at" TIMESTAMP(3);

CREATE INDEX "reports_status_processing_expires_at_idx"
ON "reports"("status", "processing_expires_at");