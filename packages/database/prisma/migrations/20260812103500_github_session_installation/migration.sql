-- Day 3 binds every GitHub state to the exact live browser session and
-- distinguishes OAuth identity linking from GitHub App installation setup.
-- Pre-Day-3 states cannot be securely associated with an initiating session.
TRUNCATE TABLE "github_oauth_states";

ALTER TABLE "github_oauth_states"
ADD COLUMN "session_id" TEXT NOT NULL,
ADD COLUMN "purpose" VARCHAR(20) NOT NULL DEFAULT 'OAUTH';

ALTER TABLE "github_oauth_states"
ADD CONSTRAINT "github_oauth_states_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "user_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "github_oauth_states_session_id_purpose_expires_at_idx"
ON "github_oauth_states"("session_id", "purpose", "expires_at");

ALTER TABLE "github_oauth_states"
ADD CONSTRAINT "github_oauth_states_purpose_check"
CHECK ("purpose" IN ('OAUTH', 'INSTALLATION'));
