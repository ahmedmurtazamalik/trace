-- CreateEnum
CREATE TYPE "public"."GithubAccountType" AS ENUM ('USER', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "public"."ActivitySource" AS ENUM ('github', 'cli');

-- CreateEnum
CREATE TYPE "public"."ActivityType" AS ENUM ('commit', 'push', 'pull_request', 'working_tree_snapshot', 'staged_change', 'untracked_file', 'local_commit');

-- CreateEnum
CREATE TYPE "public"."ReportStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "public"."ReportRevisionSource" AS ENUM ('ai', 'manual');

-- CreateEnum
CREATE TYPE "public"."ReportArtifactKind" AS ENUM ('latex', 'pdf');

-- CreateEnum
CREATE TYPE "public"."WebhookDeliveryStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(39) NOT NULL,
    "display_name" VARCHAR(100),
    "email" VARCHAR(254),
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "disabled_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."github_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "github_user_id" BIGINT NOT NULL,
    "github_username" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "unlinked_at" TIMESTAMP(3),

    CONSTRAINT "github_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."github_installations" (
    "id" TEXT NOT NULL,
    "github_installation_id" BIGINT NOT NULL,
    "github_account_id" TEXT NOT NULL,
    "account_type" "public"."GithubAccountType" NOT NULL,
    "account_login" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "suspended_at" TIMESTAMP(3),

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repositories" (
    "id" TEXT NOT NULL,
    "github_repository_id" BIGINT NOT NULL,
    "github_installation_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "private" BOOLEAN NOT NULL,
    "default_branch" TEXT NOT NULL,
    "html_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_repositories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "tracking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contributors" (
    "id" TEXT NOT NULL,
    "github_user_id" BIGINT,
    "username" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."commits" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "sha" VARCHAR(64) NOT NULL,
    "message" TEXT NOT NULL,
    "author_contributor_id" TEXT,
    "committer_contributor_id" TEXT,
    "authored_at" TIMESTAMP(3) NOT NULL,
    "committed_at" TIMESTAMP(3) NOT NULL,
    "branch" TEXT,
    "additions" INTEGER,
    "deletions" INTEGER,
    "changed_files" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."commit_files" (
    "id" TEXT NOT NULL,
    "commit_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "additions" INTEGER,
    "deletions" INTEGER,
    "previous_path" TEXT,

    CONSTRAINT "commit_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."push_events" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "github_delivery_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "before_sha" VARCHAR(64) NOT NULL,
    "after_sha" VARCHAR(64) NOT NULL,
    "sender_contributor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."activity_events" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "contributor_id" TEXT,
    "source" "public"."ActivitySource" NOT NULL,
    "type" "public"."ActivityType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."github_oauth_states" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "state_token_hash" TEXT NOT NULL,
    "intended_redirect" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "github_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."github_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "github_delivery_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "external_installation_id" BIGINT,
    "external_repository_id" BIGINT,
    "installation_id" TEXT,
    "repository_id" TEXT,
    "payload_hash" TEXT NOT NULL,
    "status" "public"."WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_started_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "processing_error" TEXT,

    CONSTRAINT "github_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "report_date" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "public"."ReportStatus" NOT NULL DEFAULT 'pending',
    "input_snapshot" JSONB NOT NULL,
    "ai_output" JSONB,
    "latex_path" TEXT,
    "pdf_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."report_revisions" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "source" "public"."ReportRevisionSource" NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."report_artifacts" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "revision_id" TEXT,
    "kind" "public"."ReportArtifactKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "request_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "public"."users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_session_token_hash_key" ON "public"."user_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_expires_at_idx" ON "public"."user_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "public"."password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_expires_at_idx" ON "public"."password_reset_tokens"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "github_accounts_user_id_key" ON "public"."github_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "github_accounts_github_user_id_key" ON "public"."github_accounts"("github_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "github_installations_github_installation_id_key" ON "public"."github_installations"("github_installation_id");

-- CreateIndex
CREATE INDEX "github_installations_github_account_id_suspended_at_idx" ON "public"."github_installations"("github_account_id", "suspended_at");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_github_repository_id_key" ON "public"."repositories"("github_repository_id");

-- CreateIndex
CREATE INDEX "repositories_github_installation_id_idx" ON "public"."repositories"("github_installation_id");

-- CreateIndex
CREATE INDEX "repositories_owner_name_idx" ON "public"."repositories"("owner", "name");

-- CreateIndex
CREATE INDEX "user_repositories_user_id_tracking_enabled_idx" ON "public"."user_repositories"("user_id", "tracking_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "user_repositories_user_id_repository_id_key" ON "public"."user_repositories"("user_id", "repository_id");

-- CreateIndex
CREATE UNIQUE INDEX "contributors_github_user_id_key" ON "public"."contributors"("github_user_id");

-- CreateIndex
CREATE INDEX "contributors_username_idx" ON "public"."contributors"("username");

-- CreateIndex
CREATE INDEX "commits_repository_id_committed_at_idx" ON "public"."commits"("repository_id", "committed_at");

-- CreateIndex
CREATE INDEX "commits_author_contributor_id_authored_at_idx" ON "public"."commits"("author_contributor_id", "authored_at");

-- CreateIndex
CREATE UNIQUE INDEX "commits_repository_id_sha_key" ON "public"."commits"("repository_id", "sha");

-- CreateIndex
CREATE UNIQUE INDEX "commit_files_commit_id_path_key" ON "public"."commit_files"("commit_id", "path");

-- CreateIndex
CREATE UNIQUE INDEX "push_events_github_delivery_id_key" ON "public"."push_events"("github_delivery_id");

-- CreateIndex
CREATE INDEX "push_events_repository_id_created_at_idx" ON "public"."push_events"("repository_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_events_repository_id_occurred_at_idx" ON "public"."activity_events"("repository_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_events_contributor_id_occurred_at_idx" ON "public"."activity_events"("contributor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_events_source_type_occurred_at_idx" ON "public"."activity_events"("source", "type", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "github_oauth_states_state_token_hash_key" ON "public"."github_oauth_states"("state_token_hash");

-- CreateIndex
CREATE INDEX "github_oauth_states_user_id_expires_at_idx" ON "public"."github_oauth_states"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "github_webhook_deliveries_github_delivery_id_key" ON "public"."github_webhook_deliveries"("github_delivery_id");

-- CreateIndex
CREATE INDEX "github_webhook_deliveries_status_received_at_idx" ON "public"."github_webhook_deliveries"("status", "received_at");

-- CreateIndex
CREATE INDEX "reports_user_id_report_date_created_at_idx" ON "public"."reports"("user_id", "report_date", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reports_user_id_report_date_key" ON "public"."reports"("user_id", "report_date");

-- CreateIndex
CREATE UNIQUE INDEX "report_revisions_report_id_revision_key" ON "public"."report_revisions"("report_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "report_revisions_id_report_id_key" ON "public"."report_revisions"("id", "report_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_artifacts_storage_key_key" ON "public"."report_artifacts"("storage_key");

-- CreateIndex
CREATE INDEX "report_artifacts_report_id_created_at_idx" ON "public"."report_artifacts"("report_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "public"."audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "public"."audit_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."github_accounts" ADD CONSTRAINT "github_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."github_installations" ADD CONSTRAINT "github_installations_github_account_id_fkey" FOREIGN KEY ("github_account_id") REFERENCES "public"."github_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."repositories" ADD CONSTRAINT "repositories_github_installation_id_fkey" FOREIGN KEY ("github_installation_id") REFERENCES "public"."github_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_repositories" ADD CONSTRAINT "user_repositories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_repositories" ADD CONSTRAINT "user_repositories_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."commits" ADD CONSTRAINT "commits_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."commits" ADD CONSTRAINT "commits_author_contributor_id_fkey" FOREIGN KEY ("author_contributor_id") REFERENCES "public"."contributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."commits" ADD CONSTRAINT "commits_committer_contributor_id_fkey" FOREIGN KEY ("committer_contributor_id") REFERENCES "public"."contributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."commit_files" ADD CONSTRAINT "commit_files_commit_id_fkey" FOREIGN KEY ("commit_id") REFERENCES "public"."commits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."push_events" ADD CONSTRAINT "push_events_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."push_events" ADD CONSTRAINT "push_events_sender_contributor_id_fkey" FOREIGN KEY ("sender_contributor_id") REFERENCES "public"."contributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activity_events" ADD CONSTRAINT "activity_events_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activity_events" ADD CONSTRAINT "activity_events_contributor_id_fkey" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."github_oauth_states" ADD CONSTRAINT "github_oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."github_webhook_deliveries" ADD CONSTRAINT "github_webhook_deliveries_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."github_webhook_deliveries" ADD CONSTRAINT "github_webhook_deliveries_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."report_revisions" ADD CONSTRAINT "report_revisions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."report_artifacts" ADD CONSTRAINT "report_artifacts_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."report_artifacts" ADD CONSTRAINT "report_artifacts_revision_id_report_id_fkey" FOREIGN KEY ("revision_id", "report_id") REFERENCES "public"."report_revisions"("id", "report_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
