# Trace User Guide

Trace organizes authorized development activity into dashboards, repository timelines, and revisioned reports. The frontend clearly separates your Trace account, your connected GitHub identity, GitHub App repository access, and the repositories you choose to track.

## Know which data you are viewing

- **Live mode:** Trace uses the configured authenticated API and its durable services.
- **Demo mode:** a persistent **Demo data** note states that no API, GitHub account, database, queue, or worker is connected. Names, repositories, activity, and reports are deterministic fixtures. Simulated changes can reset after a reload or restart.

A realistic screen in demo mode is not evidence of a live GitHub or backend connection.

## Create a Trace account

1. Open `/register`.
2. Enter a username with 3–39 letters, numbers, dots, underscores, or hyphens.
3. Optionally enter a display name and email address.
4. Enter a password of at least 12 characters.
5. Select **Create account**.

In live mode, registration creates a Trace account and signs you in with an HTTP-only cookie. Browser storage never contains the session credential.

## Sign in and sign out

1. Open `/login`.
2. Enter your Trace username and password.
3. Select **Sign in**.

When login follows a protected-page redirect, Trace returns only to a validated local Trace path. Unsafe external return URLs are ignored.

Select **Sign out** in the workspace header to revoke a live backend session. Demo mode starts with the deterministic `Trace Demo User`; it is intended for workspace exploration rather than authentication-provider testing.

## Recover a password

1. Open `/forgot-password`.
2. Enter a username or email address.
3. Select **Request reset**.
4. Trace always displays: **If the account exists, password reset instructions have been sent.**
5. Open the delivered live-mode reset link, enter a password of at least 12 characters, and select **Update password**.

The uniform forgot-password message prevents account enumeration. Reset links are single-use and expire after 30 minutes. Demo mode does not send email.

## Understand GitHub connection versus repository choices

These states are separate:

1. **Trace sign-in** identifies your Trace account.
2. **GitHub account connection** authorizes a GitHub identity; it does not replace Trace sign-in.
3. **GitHub App installation access** determines which repositories GitHub allows Trace to see.
4. **Trace tracking** is your separate choice to ingest and display an accessible repository’s activity.

Granting access does not automatically enable tracking. Stopping tracking does not revoke GitHub access. Removing a repository from Trace does not delete it from GitHub.

## Connect or manage GitHub in live mode

1. Open **GitHub**.
2. Select **Connect GitHub** or **Reconnect GitHub**.
3. Complete the backend-generated `github.com` authorization flow.
4. Install or configure the Trace GitHub App when prompted.
5. Return to Trace and confirm the linked username, installation owner, accessible repository count, and tracked count.
6. Use **Switch GitHub account** only when intentionally replacing the linked identity.
7. To disconnect, select **Disconnect GitHub**, review the confirmation, and confirm. Historical Trace activity is retained.

Trace displays closed, safe callback outcomes and never renders OAuth state or provider secrets. Demo mode shows a connected fixture, disables connect/switch/App-installation controls, and never opens live GitHub; the in-memory disconnect workflow remains available.

## Manage repositories

Open **Repositories**.

- Search by repository or owner; search is server-authoritative in live mode.
- Select **Add or refresh repositories** after changing GitHub App access.
- **GitHub access active** means the App currently authorizes the repository.
- Select **Track repository** to enable Trace tracking independently.
- Select **Stop tracking** to stop new tracking while retaining the repository entry.
- Select **Remove repository** and confirm to hide/remove the membership from the active view.
- Select **View removed repositories**, then **Restore repository** to make it active again. Restoration does not automatically enable tracking.
- Open a repository card for repository-scoped activity.

Repository URLs come from validated responses. Private/access-removed and suspended-installation states use safe, actionable messages.

## Use the dashboard

Open **Dashboard** to view deterministic totals and recent activity for one date and timezone.

1. Choose a date.
2. Choose **All repositories** or one authorized repository.
3. Review activity, repository, contributor, commit, file, addition, and deletion totals.
4. Review recent activity cards beneath the metrics.

The dashboard distinguishes GitHub-not-connected, no-tracked-repository, no-activity, partial-data, and ready states instead of showing ambiguous blank panels.

## Filter activity

Open **Activity**.

1. Choose a date and IANA timezone.
2. Optionally filter by repository, contributor, source, or activity type.
3. Apply or clear filters.
4. Use **Load more** when another cursor page is available.
5. Open repository-specific activity from a repository detail page when needed.

Filters are represented in the URL so Back/Forward navigation and shared local links restore the same view. Activity cards show source-neutral facts; raw webhook payloads and internal identifiers are not exposed.

`cli` may appear as an illustrative source in fixtures, but an operational Trace CLI does not exist yet.

## Create and review reports

Open **Reports**.

1. Choose the development-activity date. Trace shows the IANA timezone used for the request.
2. Select **Create report**.
3. Review report history states: **Pending**, **Processing**, **Completed**, or **Failed**.
4. Open a report to view its factual totals and revisioned narrative.
5. Pending/processing reports refresh automatically.

Live report creation needs the API, database, queue worker, activity data, and configured generation services. Demo mode returns deterministic in-memory responses and does not run a queue or LLM.

## Edit and regenerate a report

For a completed report:

1. Edit only narrative fields; deterministic facts remain read-only.
2. Select **Save revision** to create/adopt the updated revision.
3. Save or cancel an unsaved draft before regeneration.
4. Select **Regenerate report** on a completed or failed report to retry from the current saved revision.
5. If Trace reports a revision conflict, reload the newer revision before editing or regenerating again.

Trace prevents regeneration while an unsaved draft could be lost. Demo mode validates these frontend actions but does not provide durable revision history or real generation.

## Download report artifacts

A completed live report lists artifacts for its current revision.

1. Select the available PDF or LaTeX artifact.
2. Trace verifies the response media type, declared size, exact byte count, and SHA-256 checksum.
3. Only after verification does Trace deliver the trusted filename.
4. If an artifact is unavailable, expired, truncated, or corrupt, refresh the report and try again.

Demo mode serves checksum-consistent synthetic PDF bytes solely to validate the browser download flow; this is not evidence of real storage, LaTeX compilation, or generated report content.

## Session expiration and safe errors

Protected content remains hidden while Trace verifies the session. If the session expires, Trace returns to sign-in and preserves only the local page path. Network, validation, rate-limit, conflict, provider, and service errors are mapped to safe messages; backend internals and raw provider responses are not displayed.

## Keyboard, mobile, and accessibility

- Use **Skip to content** to bypass repeated navigation.
- All fields and controls have programmatic labels and visible focus indicators.
- Dialogs move focus inside, close the focused/topmost dialog with Escape, and restore focus to the opener.
- Status and error updates are announced to assistive technology.
- Desktop and mobile routes are tested with WCAG A/AA axe scans.
- Motion is minimized when the operating system requests reduced motion.
- Mobile navigation provides the same protected route set as desktop navigation.

## CLI status

CLI support is future work. Trace currently has no supported CLI installation, local watcher, local-commit ingestion, or CLI authentication workflow.
