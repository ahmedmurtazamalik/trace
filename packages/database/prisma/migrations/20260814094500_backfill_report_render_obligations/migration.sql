DROP TRIGGER IF EXISTS "reports_clear_current_revision_before_delete" ON "reports";
DROP FUNCTION IF EXISTS "clear_report_current_revision_before_delete"();

ALTER TABLE "reports"
  DROP CONSTRAINT "reports_current_revision_fkey";

ALTER TABLE "reports"
  ADD CONSTRAINT "reports_current_revision_id_fkey"
  FOREIGN KEY ("current_revision_id")
  REFERENCES "report_revisions"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE FUNCTION "enforce_report_current_revision_ownership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."current_revision_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "report_revisions" rr
    WHERE rr."id" = NEW."current_revision_id"
      AND rr."report_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'REPORT_CURRENT_REVISION_OWNERSHIP';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "reports_enforce_current_revision_ownership"
BEFORE INSERT OR UPDATE OF "current_revision_id", "id" ON "reports"
FOR EACH ROW
EXECUTE FUNCTION "enforce_report_current_revision_ownership"();

CREATE FUNCTION "enforce_report_revision_owner_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."report_id" IS DISTINCT FROM OLD."report_id" THEN
    RAISE EXCEPTION 'REPORT_REVISION_OWNER_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "report_revisions_enforce_owner_immutability"
BEFORE UPDATE OF "report_id" ON "report_revisions"
FOR EACH ROW
EXECUTE FUNCTION "enforce_report_revision_owner_immutability"();

UPDATE "reports" AS r
SET "render_revision" = rr."revision",
    "render_generation" = GREATEST(r."render_generation", 1),
    "render_published_at" = NULL,
    "published_at" = NULL
FROM "report_revisions" rr
WHERE r."current_revision_id" = rr."id"
  AND r."id" = rr."report_id"
  AND r."status" = 'processing'
  AND r."render_revision" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "report_artifacts" ra
    WHERE ra."report_id" = r."id"
      AND ra."revision_id" = rr."id"
      AND ra."kind" = 'pdf'
  );
