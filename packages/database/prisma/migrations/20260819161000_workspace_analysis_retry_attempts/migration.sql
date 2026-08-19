-- Analysis runs are immutable attempts. A failed attempt and its exact GitHub
-- target remain historical evidence, so retrying that target must create a new
-- attempt rather than mutating or deleting the failed one.
--
-- Concurrency remains fenced by workspace_analysis_runs_one_active_per_analysis_key,
-- which permits only one PENDING/PROCESSING run per analysis.
DROP INDEX IF EXISTS "workspace_analysis_runs_analysis_kind_sha_completed_key";
DROP INDEX IF EXISTS "workspace_analysis_runs_analysis_id_kind_to_sha_key";

CREATE INDEX "workspace_analysis_runs_analysis_id_kind_to_sha_idx"
  ON "workspace_analysis_runs"("analysis_id", "kind", "to_sha");
