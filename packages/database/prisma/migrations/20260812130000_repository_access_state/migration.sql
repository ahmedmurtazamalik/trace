ALTER TABLE "repositories"
ADD COLUMN "access_removed_at" TIMESTAMP(3),
ADD COLUMN "last_sync_sequence" BIGINT NOT NULL DEFAULT 0;

CREATE SEQUENCE "repository_sync_sequence";

ALTER TABLE "github_installations"
ADD COLUMN "sync_generation" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "user_repositories"
ADD COLUMN "access_removed_at" TIMESTAMP(3);

CREATE INDEX "repositories_github_installation_id_access_removed_at_idx"
ON "repositories"("github_installation_id", "access_removed_at");
