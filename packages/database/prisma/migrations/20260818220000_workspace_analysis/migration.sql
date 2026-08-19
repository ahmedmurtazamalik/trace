CREATE TYPE "WorkspaceAnalysisStatus" AS ENUM ('UNINITIALIZED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'BLOCKED_ACCESS');
CREATE TYPE "WorkspaceAnalysisRunKind" AS ENUM ('BASELINE', 'INCREMENTAL');
CREATE TYPE "WorkspaceAnalysisAccessState" AS ENUM ('ACTIVE', 'ACCESS_REMOVED');

CREATE TABLE "workspace_repository_analyses" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "status" "WorkspaceAnalysisStatus" NOT NULL DEFAULT 'UNINITIALIZED',
    "baseline_sha" VARCHAR(64),
    "last_analyzed_sha" VARCHAR(64),
    "baseline_started_at" TIMESTAMP(3),
    "baseline_completed_at" TIMESTAMP(3),
    "last_analyzed_at" TIMESTAMP(3),
    "access_state" "WorkspaceAnalysisAccessState" NOT NULL DEFAULT 'ACTIVE',
    "coverage" JSONB,
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspace_repository_analyses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_analysis_runs" (
    "id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "kind" "WorkspaceAnalysisRunKind" NOT NULL,
    "from_sha" VARCHAR(64),
    "to_sha" VARCHAR(64) NOT NULL,
    "data_cutoff_at" TIMESTAMP(3) NOT NULL,
    "status" "WorkspaceAnalysisStatus" NOT NULL,
    "access_state" "WorkspaceAnalysisAccessState" NOT NULL DEFAULT 'ACTIVE',
    "coverage" JSONB,
    "evidence" JSONB NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_analysis_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_repository_analyses_workspace_id_repository_id_key" ON "workspace_repository_analyses"("workspace_id", "repository_id");
CREATE INDEX "workspace_repository_analyses_workspace_id_status_idx" ON "workspace_repository_analyses"("workspace_id", "status");
CREATE INDEX "workspace_repository_analyses_repository_id_access_state_idx" ON "workspace_repository_analyses"("repository_id", "access_state");
CREATE UNIQUE INDEX "workspace_analysis_runs_analysis_id_kind_to_sha_key" ON "workspace_analysis_runs"("analysis_id", "kind", "to_sha");
CREATE INDEX "workspace_analysis_runs_workspace_id_created_at_idx" ON "workspace_analysis_runs"("workspace_id", "created_at");
CREATE INDEX "workspace_analysis_runs_repository_id_data_cutoff_at_idx" ON "workspace_analysis_runs"("repository_id", "data_cutoff_at");
CREATE INDEX "workspace_analysis_runs_status_created_at_idx" ON "workspace_analysis_runs"("status", "created_at");

ALTER TABLE "workspace_repository_analyses" ADD CONSTRAINT "workspace_repository_analyses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_repository_analyses" ADD CONSTRAINT "workspace_repository_analyses_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_analysis_runs" ADD CONSTRAINT "workspace_analysis_runs_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "workspace_repository_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_analysis_runs" ADD CONSTRAINT "workspace_analysis_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_analysis_runs" ADD CONSTRAINT "workspace_analysis_runs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
