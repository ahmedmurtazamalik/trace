CREATE TYPE "WorkspaceReportFrequency" AS ENUM ('DAILY', 'WEEKDAYS', 'SELECTED_DAYS');
CREATE TYPE "WorkspaceReportTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'RECOVERY');
CREATE TYPE "WorkspaceReportOccurrenceStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "workspace_analysis_runs" ALTER COLUMN "to_sha" DROP NOT NULL;
ALTER TABLE "workspace_analysis_runs" ALTER COLUMN "evidence" SET DEFAULT '{}';
ALTER TABLE "workspace_analysis_runs" ADD COLUMN "published_at" TIMESTAMP(3);
DROP INDEX IF EXISTS "workspace_analysis_runs_analysis_id_kind_to_sha_key";
CREATE UNIQUE INDEX "workspace_analysis_runs_analysis_kind_sha_completed_key"
  ON "workspace_analysis_runs"("analysis_id", "kind", "to_sha") WHERE "to_sha" IS NOT NULL;
CREATE UNIQUE INDEX "workspace_analysis_runs_one_active_per_analysis_key"
  ON "workspace_analysis_runs"("analysis_id") WHERE "status" IN ('PENDING', 'PROCESSING');

CREATE TABLE "workspace_report_schedules" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "frequency" "WorkspaceReportFrequency" NOT NULL,
  "selected_days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "local_time" VARCHAR(5) NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "configured_by_id" TEXT NOT NULL,
  "next_run_at" TIMESTAMP(3),
  "last_evaluated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workspace_report_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_report_schedules_version_check" CHECK ("version" > 0),
  CONSTRAINT "workspace_report_schedules_local_time_check" CHECK ("local_time" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "workspace_report_schedules_selected_days_check" CHECK ("selected_days" <@ ARRAY[1,2,3,4,5,6,7])
);

CREATE TABLE "workspace_report_occurrences" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "schedule_id" TEXT,
  "schedule_version" INTEGER,
  "trigger" "WorkspaceReportTrigger" NOT NULL,
  "scheduled_for" TIMESTAMP(3),
  "intended_local_date_time" VARCHAR(40),
  "window_start" TIMESTAMP(3) NOT NULL,
  "window_end" TIMESTAMP(3) NOT NULL,
  "data_cutoff_at" TIMESTAMP(3) NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "status" "WorkspaceReportOccurrenceStatus" NOT NULL DEFAULT 'PENDING',
  "report_id" TEXT,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "evidence_snapshot" JSONB NOT NULL,
  "no_activity" BOOLEAN,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "error" VARCHAR(500),
  CONSTRAINT "workspace_report_occurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_report_occurrences_window_check" CHECK ("window_start" < "window_end" AND "data_cutoff_at" >= "window_start"),
  CONSTRAINT "workspace_report_occurrences_schedule_shape_check" CHECK (("trigger" = 'MANUAL' AND "schedule_id" IS NULL AND "scheduled_for" IS NULL) OR ("trigger" <> 'MANUAL' AND "schedule_id" IS NOT NULL AND "schedule_version" IS NOT NULL AND "scheduled_for" IS NOT NULL))
);

ALTER TABLE "reports" ADD COLUMN "workspace_id" TEXT;
DROP INDEX IF EXISTS "reports_user_id_report_date_key";
CREATE UNIQUE INDEX "reports_personal_user_date_key" ON "reports"("user_id", "report_date") WHERE "workspace_id" IS NULL;
CREATE INDEX "reports_workspace_id_created_at_idx" ON "reports"("workspace_id", "created_at");

CREATE UNIQUE INDEX "workspace_report_schedules_workspace_id_key" ON "workspace_report_schedules"("workspace_id");
CREATE INDEX "workspace_report_schedules_enabled_next_run_at_idx" ON "workspace_report_schedules"("enabled", "next_run_at");
CREATE UNIQUE INDEX "workspace_report_occurrences_report_id_key" ON "workspace_report_occurrences"("report_id");
CREATE UNIQUE INDEX "workspace_report_occurrences_workspace_id_idempotency_key_key" ON "workspace_report_occurrences"("workspace_id", "idempotency_key");
CREATE UNIQUE INDEX "workspace_report_occurrences_schedule_id_scheduled_for_key" ON "workspace_report_occurrences"("schedule_id", "scheduled_for");
CREATE INDEX "workspace_report_occurrences_status_published_at_created_at_idx" ON "workspace_report_occurrences"("status", "published_at", "created_at");
CREATE INDEX "workspace_report_occurrences_workspace_id_created_at_idx" ON "workspace_report_occurrences"("workspace_id", "created_at");

ALTER TABLE "workspace_report_schedules" ADD CONSTRAINT "workspace_report_schedules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_report_schedules" ADD CONSTRAINT "workspace_report_schedules_configured_by_id_fkey" FOREIGN KEY ("configured_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_report_occurrences" ADD CONSTRAINT "workspace_report_occurrences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_report_occurrences" ADD CONSTRAINT "workspace_report_occurrences_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "workspace_report_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_report_occurrences" ADD CONSTRAINT "workspace_report_occurrences_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_report_occurrences" ADD CONSTRAINT "workspace_report_occurrences_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
