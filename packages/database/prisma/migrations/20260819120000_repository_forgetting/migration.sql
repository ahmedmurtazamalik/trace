ALTER TABLE "user_repositories"
ADD COLUMN "forgotten_at" TIMESTAMP(3);

CREATE INDEX "user_repositories_user_id_forgotten_at_idx"
ON "user_repositories"("user_id", "forgotten_at");
