CREATE FUNCTION "prevent_direct_report_revision_deletion"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Report revisions may only be removed by deleting their parent report.';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "report_revision_delete_with_parent_only"
BEFORE DELETE ON "report_revisions"
FOR EACH ROW
EXECUTE FUNCTION "prevent_direct_report_revision_deletion"();
