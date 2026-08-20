ALTER TABLE "workspace_invitations" ADD COLUMN "token_hash" CHAR(64);

UPDATE "workspace_invitations"
SET "token_hash" = md5("id" || random()::text || clock_timestamp()::text)
                 || md5(random()::text || "id" || clock_timestamp()::text)
WHERE "token_hash" IS NULL;

ALTER TABLE "workspace_invitations" ALTER COLUMN "token_hash" SET NOT NULL;
CREATE UNIQUE INDEX "workspace_invitations_token_hash_key" ON "workspace_invitations"("token_hash");
