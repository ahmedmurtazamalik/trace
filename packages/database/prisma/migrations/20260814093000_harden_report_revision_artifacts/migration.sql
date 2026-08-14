ALTER TABLE "reports"
  ADD COLUMN "render_generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "current_revision_id" TEXT;

UPDATE "reports" AS r
SET "current_revision_id" = (
  SELECT rr."id"
  FROM "report_revisions" rr
  WHERE rr."report_id" = r."id"
  ORDER BY rr."revision" DESC
  LIMIT 1
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "report_artifacts" WHERE "revision_id" IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce artifact revision ownership: null revision_id exists';
  END IF;
END $$;

ALTER TABLE "report_artifacts"
  ALTER COLUMN "revision_id" SET NOT NULL;

ALTER TABLE "reports"
  ADD CONSTRAINT "reports_render_generation_nonnegative"
  CHECK ("render_generation" >= 0),
  ADD CONSTRAINT "reports_current_revision_fkey"
  FOREIGN KEY ("current_revision_id", "id")
  REFERENCES "report_revisions"("id", "report_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_artifacts"
  ADD CONSTRAINT "report_artifacts_size_bounds"
  CHECK ("size_bytes" > 0 AND "size_bytes" <= 100000000),
  ADD CONSTRAINT "report_artifacts_checksum_sha256"
  CHECK ("checksum" ~ '^[a-f0-9]{64}$');

CREATE UNIQUE INDEX "report_artifacts_report_id_revision_id_kind_key"
  ON "report_artifacts"("report_id", "revision_id", "kind");
