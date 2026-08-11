You are building ONLY the generic Trace CLI package.

Do not build any web frontend, backend server, database, GitHub App, GitHub OAuth flow, AI report generator, LaTeX generator, admin dashboard, or personalized installer service.

The deliverable is one reusable, cross-platform CLI codebase and binary named `trace`.

==================================================
PRODUCT CONTEXT
==================================================

Trace is a work-tracking application.

The Trace CLI runs on a user's computer and observes local Git repository activity that GitHub cannot see, including:

- Staged files
- Unstaged files
- Untracked files
- Local commits that may not have been pushed yet
- Current branch and HEAD commit
- Repository remote information

The CLI sends structured activity events to an external Trace API.

The CLI binary must be completely generic. Do not compile separate binaries for individual users.

A generic CLI becomes associated with a specific Trace user through a one-time enrollment token supplied during installation or first launch.

The Trace backend does not exist in this task. Implement the CLI against the API contracts defined below. Use interfaces, mocks, and test servers for testing.

==================================================
TECHNOLOGY
==================================================

Implement the CLI in Go.

Requirements:

- Produce standalone executables for Windows, macOS, and Linux
- Use a clean, modular project structure
- Avoid CGO unless absolutely necessary
- Use Go's standard library where practical
- Use a mature CLI command framework such as Cobra
- Use a platform-compatible secure credential-storage library
- Use UUIDs for event IDs and local repository IDs
- Include unit tests and integration-style tests using an HTTP test server
- Include a README with build, installation, enrollment, and usage instructions

The final program must compile successfully.

==================================================
ABSOLUTE SCOPE LIMITS
==================================================

Build only the CLI.

Do not:

- Create a frontend
- Create a backend
- Create database migrations
- Implement GitHub login
- Call the GitHub API
- Generate reports
- Generate LaTeX
- Use an LLM
- Upload entire source files
- Upload file contents by default
- Collect keystrokes
- Monitor applications outside Git repositories
- Add telemetry unrelated to Trace activity
- Embed a permanent user token in the binary
- Build a unique binary for each user
- Create a background operating-system service in this version
- Execute Git commands through a shell
- Trust a user ID supplied in an activity payload

The CLI should only collect Git metadata and repository-relative change metadata.

==================================================
CORE DESIGN
==================================================

The same `trace` binary is distributed to every user.

The user-specific relationship is established as follows:

1. A personalized installer or the Trace web app provides a short-lived, one-time enrollment token.
2. The generic CLI receives that token.
3. The CLI sends the token to the Trace enrollment API.
4. The API returns credentials for one device.
5. The CLI stores the device credentials securely.
6. Every later API request is authenticated with that device's credential.
7. The backend determines the Trace user from the authenticated device token.

The personalized installer itself is outside this task.

However, the CLI must support unattended enrollment so another installer can run:

    trace enroll --token "<one-time-token>"

The CLI must also support enrollment through:

    TRACE_ENROLLMENT_TOKEN="<one-time-token>" trace enroll

And through an enrollment file:

    trace enroll --file "/path/to/trace-enrollment.json"

An enrollment file has this structure:

{
  "enrollment_token": "opaque-one-time-token",
  "api_url": "https://api.trace.example.com"
}

After successful enrollment:

- Delete the enrollment file when possible
- Never store the one-time enrollment token
- Never print the enrollment token
- Never write the enrollment token to logs
- Store the returned refresh credential securely
- Display the associated username only if the API returns it

==================================================
CLI COMMANDS
==================================================

Implement these commands:

1. `trace enroll`

Examples:

    trace enroll --token TOKEN
    trace enroll --file trace-enrollment.json
    TRACE_ENROLLMENT_TOKEN=TOKEN trace enroll

Options:

    --token
    --file
    --api-url
    --device-name

Behavior:

- Read the one-time enrollment token
- Collect platform, architecture, hostname-derived device name, and CLI version
- Call the enrollment API
- Store the returned device ID and refresh credential
- Store non-secret configuration separately
- Remove the enrollment file after successful enrollment
- Do not expose secrets in output

2. `trace status`

Display:

- Whether the CLI is enrolled
- Trace username, when available
- Device name
- Device ID, partially redacted
- API URL
- CLI version
- Number of registered repositories
- Number of queued events
- Last successful synchronization
- Whether credentials are valid
- Never display access or refresh tokens

3. `trace repo add [path]`

Behavior:

- Default to the current directory
- Resolve the Git repository root
- Reject directories that are not Git repositories
- Generate or load a stable local repository UUID
- Store the UUID under the repository's Git directory, not in the working tree
- Recommended location:

      .git/trace/repository-id

- Register the canonical repository root in local CLI configuration
- Do not use the repository's absolute path as its server-side identity
- Allow the same repository to be added only once

4. `trace repo remove [path-or-id]`

Behavior:

- Remove the repository from the CLI's tracked repository list
- Do not delete the actual repository
- Do not delete Git data
- Do not delete already queued events

5. `trace repo list`

Display:

- Repository display name
- Local repository UUID, partially redacted
- Current branch when available
- Normalized remote identity when available
- Whether pending activity exists
- Do not print remote URLs containing credentials

6. `trace scan [path]`

Behavior:

- When a path is provided, scan that Git repository
- Without a path, scan every registered repository
- Create working-tree snapshot events
- Detect new local commit observations
- Add events to the durable local queue
- Attempt synchronization after scanning unless `--no-sync` is used
- Return a useful nonzero exit code when scanning fails

Options:

    --no-sync
    --json

7. `trace watch`

Behavior:

- Run in the foreground
- Scan registered repositories repeatedly
- Default interval: 5 minutes
- Allow interval configuration
- Handle Ctrl+C and termination signals gracefully
- Flush queued events before exiting when practical
- Do not install itself as an operating-system service
- Do not create a daemon in this version

Options:

    --interval
    --no-sync

8. `trace sync`

Behavior:

- Send queued events in batches
- Refresh the access token when required
- Retry temporary errors with exponential backoff and jitter
- Do not retry permanent 4xx validation or authorization errors indefinitely
- Preserve unsent events
- Delete an event from the queue only after the server has accepted it
- Support partial batch acceptance if returned by the server

Options:

    --json
    --max-batch-size

9. `trace doctor`

Check:

- Git is installed
- CLI configuration is readable
- Secure credential storage is available
- Enrollment state is valid
- API is reachable
- Registered repository paths still exist
- Registered paths are Git repositories
- Local queue is readable and writable
- Repository IDs are valid
- No remote URL credentials are being retained

Provide clear remediation messages.

10. `trace logout`

Behavior:

- Remove local access and refresh credentials
- Remove local device authentication state
- Preserve repository registrations by default
- Preserve unsent events by default
- Support:

      trace logout --purge

- `--purge` may also remove local Trace configuration, tracked-repository registrations, queue data, and local state
- Never modify source files or normal Git history

11. `trace version`

Print the CLI version, operating system, and architecture.

==================================================
CONFIGURATION
==================================================

Store non-secret application configuration in the platform-appropriate user configuration directory.

Examples include:

- Linux: XDG-compatible config and state locations
- macOS: Application Support-compatible location
- Windows: AppData-compatible location

Do not hardcode one operating system's path structure.

Configuration should contain non-secret data such as:

{
  "api_url": "https://api.trace.example.com",
  "device_id": "device-id",
  "device_name": "Ahmed's MacBook",
  "username": "ahmed",
  "scan_interval": "5m",
  "repositories": [
    {
      "local_repository_id": "uuid",
      "path": "/local/path",
      "display_name": "backend"
    }
  ]
}

Do not store the refresh token in this configuration file.

Store secrets in the operating system credential manager.

Where secure storage is unavailable, fail with an actionable error by default. A file-based fallback may be implemented only when the user explicitly enables it, and the fallback file must use the strictest practical file permissions.

Support these environment variables:

    TRACE_API_URL
    TRACE_ENROLLMENT_TOKEN
    TRACE_LOG_LEVEL
    TRACE_CONFIG_DIR
    TRACE_STATE_DIR

Environment variables override configuration-file values.

==================================================
API CONTRACTS
==================================================

Make the API URL configurable.

Never hardcode a production hostname except as a documented default placeholder.

------------------------------------------
Enrollment
------------------------------------------

Request:

POST /api/v1/cli/enroll
Content-Type: application/json

{
  "enrollment_token": "opaque-one-time-token",
  "device": {
    "name": "Ahmed's MacBook",
    "platform": "darwin",
    "architecture": "arm64",
    "cli_version": "1.0.0"
  }
}

Example successful response:

{
  "device_id": "dev_123",
  "access_token": "short-lived-access-token",
  "access_token_expires_at": "2026-08-11T12:30:00Z",
  "refresh_token": "long-random-refresh-token",
  "user": {
    "id": "usr_123",
    "username": "ahmed"
  }
}

The CLI may retain the user ID only as non-authoritative display metadata.

The CLI must never send this user ID as proof of identity.

------------------------------------------
Refresh access token
------------------------------------------

Request:

POST /api/v1/cli/token/refresh
Content-Type: application/json

{
  "device_id": "dev_123",
  "refresh_token": "long-random-refresh-token"
}

Example response:

{
  "access_token": "new-short-lived-access-token",
  "access_token_expires_at": "2026-08-11T13:30:00Z",
  "refresh_token": "optional-rotated-refresh-token"
}

Support refresh-token rotation. If a new refresh token is returned, replace the old one securely.

------------------------------------------
Heartbeat
------------------------------------------

Request:

POST /api/v1/cli/heartbeat
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "device_id": "dev_123",
  "cli_version": "1.0.0",
  "platform": "darwin",
  "architecture": "arm64",
  "sent_at": "2026-08-11T12:00:00Z"
}

------------------------------------------
Batch activity upload
------------------------------------------

Request:

POST /api/v1/cli/events/batch
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "device_id": "dev_123",
  "events": [
    {
      "event_id": "uuid",
      "event_type": "working_tree_snapshot",
      "observed_at": "2026-08-11T12:00:00Z",
      "repository": {},
      "data": {}
    }
  ]
}

Example response:

{
  "accepted_event_ids": [
    "uuid-1"
  ],
  "duplicate_event_ids": [
    "uuid-2"
  ],
  "rejected_events": [
    {
      "event_id": "uuid-3",
      "code": "REPOSITORY_NOT_AUTHORIZED",
      "message": "Repository is not connected to this Trace account."
    }
  ]
}

Treat accepted and duplicate events as successfully delivered.

Keep retryable rejected events queued.

Move permanent rejected events to a dead-letter queue or durable failed-event store so they are inspectable and are not retried forever.

==================================================
REPOSITORY IDENTITY
==================================================

Every local repository must have a stable random UUID called:

    local_repository_id

Store it under the Git metadata directory.

Do not derive it from:

- Absolute filesystem path
- Username
- Repository name
- Remote URL
- Device ID

This allows the repository to retain its identity when moved to a different local path.

For normal repositories:

    <repository-root>/.git/trace/repository-id

Also correctly support Git worktrees and cases where `.git` is a file rather than a directory. Determine the actual Git directory using Git itself, such as:

    git rev-parse --git-dir
    git rev-parse --show-toplevel

Do not assume `.git` is always a directory.

==================================================
REMOTE NORMALIZATION
==================================================

Read the origin remote when available:

    git remote get-url origin

Normalize GitHub remotes.

These examples must normalize to the same identity:

    git@github.com:acme/backend.git
    https://github.com/acme/backend.git
    ssh://git@github.com/acme/backend.git

Normalized representation:

{
  "provider": "github",
  "host": "github.com",
  "owner": "acme",
  "name": "backend",
  "full_name": "acme/backend"
}

Remote normalization must:

- Lowercase the hostname
- Remove a final `.git`
- Handle SSH and HTTPS formats
- Remove query strings and fragments
- Never send embedded usernames, passwords, access tokens, or other credentials
- Never save credential-bearing URLs
- Reject malformed remotes safely

For non-GitHub remotes, return a sanitized generic representation or mark the provider as `unknown`.

Do not call GitHub APIs.

==================================================
GIT DATA COLLECTION
==================================================

Use Git commands through `exec.CommandContext` or an equivalent safe API.

Never concatenate untrusted values into a shell command.

Never run:

    sh -c
    bash -c
    cmd /c
    powershell -Command

Prefer machine-readable, null-delimited Git output.

Use commands such as:

    git rev-parse --show-toplevel
    git rev-parse --git-dir
    git rev-parse HEAD
    git branch --show-current
    git status --porcelain=v2 -z
    git diff --numstat -z
    git diff --cached --numstat -z
    git remote get-url origin

Correctly handle:

- Spaces in filenames
- Unicode filenames
- Renamed files
- Deleted files
- Added files
- Modified files
- Unmerged files
- Detached HEAD
- Repositories with no commits
- Repositories with no origin remote
- Repositories with no configured upstream
- Git worktrees
- Subdirectories inside a repository
- Untracked files
- Ignored files, which should not be reported
- Binary files, whose line counts may be unavailable

All file paths sent to the API must be repository-relative.

Do not send the user's absolute repository path to the API.

==================================================
WORKING-TREE SNAPSHOT EVENT
==================================================

Create an event with this structure:

{
  "event_id": "uuid",
  "event_type": "working_tree_snapshot",
  "observed_at": "RFC3339 timestamp",
  "repository": {
    "local_repository_id": "uuid",
    "display_name": "backend",
    "remote": {
      "provider": "github",
      "host": "github.com",
      "owner": "acme",
      "name": "backend",
      "full_name": "acme/backend"
    },
    "head": {
      "branch": "feature/auth",
      "commit_sha": "full-sha-or-null",
      "detached": false
    }
  },
  "data": {
    "staged": [
      {
        "path": "src/auth.go",
        "status": "modified",
        "additions": 20,
        "deletions": 4,
        "binary": false
      }
    ],
    "unstaged": [],
    "untracked": [
      {
        "path": "src/session.go",
        "status": "untracked"
      }
    ],
    "conflicted": []
  }
}

Do not include file contents.

Do not include complete patches.

Do not include absolute paths.

Calculate a deterministic snapshot hash from the normalized working-tree state.

If the repository state has not changed since the last successfully queued snapshot, do not create another identical snapshot event.

The event ID must remain stable across retries.

==================================================
LOCAL COMMIT OBSERVATION EVENT
==================================================

Create a separate event for a locally observed commit:

{
  "event_id": "uuid",
  "event_type": "local_commit_observation",
  "observed_at": "RFC3339 timestamp",
  "repository": {
    "local_repository_id": "uuid",
    "display_name": "backend",
    "remote": {
      "provider": "github",
      "host": "github.com",
      "owner": "acme",
      "name": "backend",
      "full_name": "acme/backend"
    }
  },
  "data": {
    "sha": "full-commit-sha",
    "parents": [
      "parent-sha"
    ],
    "message_subject": "Implement authentication",
    "author_name": "Developer Name",
    "author_email": "developer@example.com",
    "authored_at": "RFC3339 timestamp",
    "committed_at": "RFC3339 timestamp",
    "branch": "feature/auth",
    "ahead_of_upstream": true
  }
}

Do not upload commit patches or source contents.

The backend will deduplicate local and GitHub commit observations using:

    canonical repository identity + commit SHA

The CLI must ensure it does not create repeated local observation events for the same:

    local_repository_id + commit SHA

Persist observed commit state locally.

When an upstream exists, identify commits ahead of the upstream.

When no upstream exists, report newly observed local commits without crashing.

Avoid traversing an unlimited repository history. Use persisted state and reasonable safety limits.

==================================================
LOCAL DURABLE QUEUE
==================================================

Implement a durable local event queue.

Acceptable implementations include:

- SQLite
- A carefully implemented atomic file-backed queue

SQLite is preferred.

Queue requirements:

- Survive process restarts
- Preserve the original event ID
- Preserve the original observation timestamp
- Support batch reads
- Support successful acknowledgement
- Support retry counts
- Store the next retry time
- Store the latest error
- Support a dead-letter state
- Prevent corruption during concurrent commands
- Avoid sending the same queue item concurrently
- Use transactions for queue changes
- Never store access or refresh tokens in the queue

Suggested fields:

    event_id
    event_type
    payload_json
    repository_id
    created_at
    attempt_count
    next_attempt_at
    status
    last_error

Statuses:

    pending
    sending
    failed
    dead_letter

Recover events left in `sending` after a crash.

==================================================
NETWORKING
==================================================

Use HTTPS by default.

Networking requirements:

- Configurable request timeout
- Context cancellation
- Exponential backoff with jitter
- Bounded retries
- Respect `Retry-After` when present
- Handle 401 by refreshing the access token once and retrying
- Handle 403 as an authorization failure
- Handle 409 duplicate responses safely
- Handle 429 as rate limiting
- Retry 5xx and temporary network failures
- Do not retry invalid 4xx requests forever
- Set a clear User-Agent containing the CLI version
- Limit response-body sizes before reading them
- Validate JSON responses
- Never log bearer tokens
- Redact sensitive headers and enrollment data

Create an API client interface so tests can replace the real HTTP implementation.

==================================================
SECURITY AND PRIVACY
==================================================

Security requirements are mandatory.

- Never print secrets
- Never log secrets
- Never include secrets in errors
- Never place secrets in command history when avoidable
- Warn that `--token` may be visible in shell history and recommend the environment variable or enrollment file for manual enrollment
- Redact credentials from remote URLs
- Do not send absolute local paths
- Do not send source-file contents
- Do not send full diffs
- Do not follow symlinks outside the repository to read content
- Do not inspect ignored files
- Do not collect environment variables except the documented Trace variables
- Do not collect SSH keys or Git credential files
- Do not inspect browser data
- Do not use GitHub credentials
- Do not execute Git hooks
- Do not automatically alter `.gitignore`
- Do not modify working-tree files
- Do not create commits
- Do not stage files
- Do not push anything
- Do not change branches
- Do not modify remotes

Use restrictive permissions for local state files wherever the operating system supports them.

==================================================
LOGGING AND OUTPUT
==================================================

Default output should be human-readable.

Support `--json` for commands where machine-readable output is useful.

Logging levels:

    error
    warn
    info
    debug

Never include secrets at any log level.

Debug logs may include:

- Endpoint path without sensitive query parameters
- HTTP status
- Repository local UUID
- Event ID
- Git command name and sanitized arguments
- Retry count

Debug logs must not include:

- Authorization headers
- Refresh tokens
- Enrollment tokens
- Credential-bearing URLs
- File contents
- Complete API payloads containing sensitive values

==================================================
ERROR HANDLING
==================================================

Use stable exit codes.

At minimum, distinguish:

- Success
- Invalid command usage
- Not enrolled
- Git unavailable
- Not a Git repository
- Authentication failure
- Authorization failure
- Network failure
- Local storage failure
- Partial synchronization failure

Errors should be actionable.

Example:

    Trace is not enrolled. Install Trace from your account or run:
    trace enroll --file trace-enrollment.json

Do not expose stack traces by default.

==================================================
PROJECT STRUCTURE
==================================================

Use a structure similar to:

    cmd/trace/
        main.go

    internal/command/
        root.go
        enroll.go
        status.go
        repo.go
        scan.go
        watch.go
        sync.go
        doctor.go
        logout.go
        version.go

    internal/api/
        client.go
        models.go
        auth.go
        errors.go

    internal/auth/
        credentials.go
        keyring.go

    internal/config/
        config.go
        paths.go

    internal/git/
        repository.go
        status.go
        diff.go
        commits.go
        remote.go

    internal/activity/
        events.go
        snapshot.go
        commits.go

    internal/queue/
        queue.go
        sqlite.go

    internal/repository/
        registry.go
        identity.go

    internal/sync/
        service.go
        retry.go

    internal/version/
        version.go

    testdata/

    README.md
    go.mod
    go.sum
    Makefile
    .gitignore
    .goreleaser.yaml

You may improve this structure, but preserve clear separation of concerns.

==================================================
TESTING
==================================================

Write meaningful tests.

At minimum, test:

1. GitHub remote normalization

Inputs:

    git@github.com:acme/backend.git
    https://github.com/acme/backend.git
    ssh://git@github.com/acme/backend.git

Expected canonical identity:

    github.com/acme/backend

2. Credential-bearing remote sanitization

Ensure tokens and passwords never appear in normalized output or logs.

3. Porcelain Git status parsing

Include:

- Spaces
- Unicode
- Rename
- Delete
- Add
- Modification
- Untracked file
- Conflict
- Null-delimited records

4. Stable local repository UUID behavior

- Same repository returns same UUID
- Moving the repository does not regenerate the UUID
- Worktree Git directories are handled

5. Snapshot deduplication

- Identical state creates one queued event
- Changed state creates a new event

6. Commit observation deduplication

- Same local repository ID and SHA creates one event
- Different commits create separate events

7. Queue persistence

- Events survive process restart
- Acknowledged events are removed
- Failed events remain queued
- Crashed `sending` events recover

8. Enrollment

- One-time token is submitted
- Credential is stored
- Token is not retained
- Enrollment file is deleted after success
- Failed enrollment does not delete the file
- Secrets do not appear in output

9. Token refresh

- Expired access token refreshes
- Rotated refresh token replaces the old token
- Failed refresh produces an authentication error

10. Batch synchronization

- Accepted events are acknowledged
- Duplicate events are acknowledged
- Temporary failures are retried
- Permanent failures move to failed/dead-letter state
- Partial responses are handled correctly

11. Privacy

- API payloads contain repository-relative paths only
- Absolute paths are not uploaded
- File contents are not uploaded
- Secrets are not logged

12. CLI integration behavior

Use temporary Git repositories in tests to verify:

- Repository registration
- Staged changes
- Unstaged changes
- Untracked files
- Local commit detection
- Repositories without a remote
- Repositories without commits
- Detached HEAD where practical

Use `httptest.Server` or an equivalent local mock API server. Do not require a real Trace backend.

==================================================
DOCUMENTATION
==================================================

Create a complete README containing:

- What the CLI does
- What it does not do
- Build instructions
- Generic installation instructions
- Enrollment-token flow
- Automatic enrollment examples
- Repository registration
- Manual scanning
- Foreground watching
- Synchronization
- Configuration locations
- Environment variables
- Security and privacy behavior
- API contract summary
- Troubleshooting
- Development and test commands
- Release build instructions

Clearly explain:

“The Trace CLI binary is generic. It becomes user-specific only after exchanging a one-time enrollment token for a per-device credential.”

Include sample usage:

    trace enroll --file trace-enrollment.json
    trace repo add .
    trace scan
    trace watch --interval 5m
    trace status
    trace doctor

==================================================
BUILD AND RELEASE
==================================================

Provide:

- `go build` support
- A Makefile with build, test, lint, and clean commands
- Cross-platform release configuration
- Version injection through build flags
- Release archives for Windows, macOS, and Linux
- SHA-256 checksums
- No signing keys or fake credentials
- No real production tokens
- No hardcoded secrets

The binary name must be:

    trace

==================================================
IMPLEMENTATION PROCESS
==================================================

Complete the implementation rather than only generating a design document.

Work in this order:

1. Create the project structure.
2. Implement configuration and platform paths.
3. Implement secure credential abstraction.
4. Implement enrollment and token refresh.
5. Implement repository registration and stable IDs.
6. Implement Git remote normalization.
7. Implement Git status and diff-stat collection.
8. Implement local commit observation.
9. Implement activity event models.
10. Implement the durable queue.
11. Implement synchronization and retry behavior.
12. Implement all CLI commands.
13. Add tests.
14. Run formatting.
15. Run the full test suite.
16. Build the CLI.
17. Fix all compilation and test failures.
18. Write the README.
19. Provide a final summary of implemented files and commands.

Do not stop after scaffolding.

Do not leave core features as TODO comments.

Do not claim tests pass unless you actually run them.

==================================================
DEFINITION OF DONE
==================================================

The task is complete only when:

- The generic `trace` CLI builds successfully
- It runs on the development platform
- Cross-platform build configuration exists
- Enrollment works against a mock API
- No permanent user credential is embedded in the executable
- Each installation receives a separate device credential
- Repository registration works
- GitHub remotes normalize correctly
- Local-only repositories receive stable UUIDs
- Staged, unstaged, and untracked states are detected
- Local commits are observed
- Events are stored durably
- Events synchronize in batches
- API retries are idempotent
- Tokens are refreshed securely
- Duplicate snapshots and commit observations are avoided
- File contents and absolute paths are not uploaded
- All tests pass
- The README explains how an external personalized installer supplies the one-time enrollment token

At the end, output:

1. A concise implementation summary
2. The resulting directory tree
3. Commands used to build and test
4. Test results
5. Any assumptions made about the external Trace API

Remember: build ONLY the generic Trace CLI package.
