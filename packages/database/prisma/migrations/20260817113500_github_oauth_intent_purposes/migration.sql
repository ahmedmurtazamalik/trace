ALTER TABLE "github_oauth_states"
DROP CONSTRAINT "github_oauth_states_purpose_check";

ALTER TABLE "github_oauth_states"
ADD CONSTRAINT "github_oauth_states_purpose_check"
CHECK ("purpose" IN ('OAUTH', 'OAUTH_CONNECT', 'OAUTH_SWITCH', 'INSTALLATION', 'INSTALLATION_VERIFY'));
