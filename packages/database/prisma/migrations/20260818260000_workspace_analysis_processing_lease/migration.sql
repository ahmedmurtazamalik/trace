ALTER TABLE "workspace_analysis_runs"
ADD COLUMN "processing_token" TEXT,
ADD COLUMN "processing_expires_at" TIMESTAMP(3);

CREATE INDEX "workspace_analysis_runs_status_processing_expires_at_idx"
ON "workspace_analysis_runs"("status", "processing_expires_at");
