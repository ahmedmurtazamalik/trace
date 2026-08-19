CREATE FUNCTION "prevent_report_artifact_metadata_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."id", NEW."report_id", NEW."revision_id", NEW."kind",
    NEW."storage_key", NEW."size_bytes", NEW."checksum", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."report_id", OLD."revision_id", OLD."kind",
    OLD."storage_key", OLD."size_bytes", OLD."checksum", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'report artifact identity and metadata are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "report_artifact_metadata_immutable"
BEFORE UPDATE ON "report_artifacts"
FOR EACH ROW
EXECUTE FUNCTION "prevent_report_artifact_metadata_mutation"();
