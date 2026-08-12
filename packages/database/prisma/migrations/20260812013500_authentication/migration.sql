-- Day 2 introduces authenticated sessions. Any pre-contract sessions are revoked
-- because they cannot contain a CSRF token hash.
TRUNCATE TABLE "user_sessions";

ALTER TABLE "user_sessions"
ADD COLUMN "csrf_token_hash" TEXT NOT NULL;

CREATE UNIQUE INDEX "user_sessions_csrf_token_hash_key"
ON "user_sessions"("csrf_token_hash");

-- Trace identity lookup is case-insensitive. These indexes fail closed if
-- pre-existing rows conflict instead of allowing ambiguous login ownership.
CREATE UNIQUE INDEX "users_username_ci_key"
ON "users"(LOWER("username"));

CREATE UNIQUE INDEX "users_email_ci_key"
ON "users"(LOWER("email"))
WHERE "email" IS NOT NULL;
