CREATE FUNCTION "prevent_report_revision_latex_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."latex_source" IS NOT NULL
     AND NEW."latex_source" IS DISTINCT FROM OLD."latex_source" THEN
    RAISE EXCEPTION 'Report revision LaTeX source is immutable once frozen.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "report_revision_latex_immutable"
BEFORE UPDATE OF "latex_source" ON "report_revisions"
FOR EACH ROW
EXECUTE FUNCTION "prevent_report_revision_latex_mutation"();
