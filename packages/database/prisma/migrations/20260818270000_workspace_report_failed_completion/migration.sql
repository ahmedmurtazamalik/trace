CREATE OR REPLACE FUNCTION "protect_workspace_report_occurrence_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
       AND NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = OLD."workspace_id") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'workspace report occurrence snapshot cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF pg_trigger_depth() > 1
     AND NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = OLD."workspace_id")
     AND NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = NEW."workspace_id") THEN
    RETURN NEW;
  END IF;

  IF OLD."status" IN ('COMPLETED', 'FAILED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal workspace report occurrence is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF ROW(
    NEW."id", NEW."workspace_id", NEW."schedule_id", NEW."schedule_version",
    NEW."trigger", NEW."scheduled_for", NEW."intended_local_date_time",
    NEW."window_start", NEW."window_end", NEW."data_cutoff_at",
    NEW."requested_by_id", NEW."idempotency_key", NEW."evidence_snapshot",
    NEW."no_activity", NEW."recovered_at", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."workspace_id", OLD."schedule_id", OLD."schedule_version",
    OLD."trigger", OLD."scheduled_for", OLD."intended_local_date_time",
    OLD."window_start", OLD."window_end", OLD."data_cutoff_at",
    OLD."requested_by_id", OLD."idempotency_key", OLD."evidence_snapshot",
    OLD."no_activity", OLD."recovered_at", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'workspace report occurrence snapshot is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')) OR
    (OLD."status" = 'QUEUED' AND NEW."status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')) OR
    (OLD."status" = 'PROCESSING' AND NEW."status" IN ('PENDING', 'COMPLETED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'workspace report occurrence lifecycle transition is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'COMPLETED' AND (NEW."report_id" IS NULL OR NEW."started_at" IS NULL OR NEW."completed_at" IS NULL OR NEW."error" IS NOT NULL) THEN
    RAISE EXCEPTION 'completed workspace report occurrence identity is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'FAILED' AND (NEW."started_at" IS NULL OR NEW."error" IS NULL OR NEW."completed_at" IS NULL) THEN
    RAISE EXCEPTION 'failed workspace report occurrence identity is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
