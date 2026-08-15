ALTER TABLE "reports"
  ADD COLUMN "render_revision" INTEGER,
  ADD COLUMN "render_published_at" TIMESTAMP(3);

ALTER TABLE "reports"
  ADD CONSTRAINT "reports_render_revision_positive"
  CHECK ("render_revision" IS NULL OR "render_revision" > 0);

CREATE INDEX "reports_status_render_published_at_idx"
  ON "reports"("status", "render_published_at");
