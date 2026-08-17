ALTER TABLE "user_repositories"
ADD COLUMN "removed_at" TIMESTAMP(3);

CREATE INDEX "user_repositories_user_id_removed_at_idx"
ON "user_repositories"("user_id", "removed_at");
