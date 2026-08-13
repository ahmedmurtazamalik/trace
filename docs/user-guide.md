# Trace User Guide

## Create an account

1. Open `/register`.
2. Enter a username containing 3–39 letters, numbers, dots, underscores, or hyphens.
3. Optionally add a display name and email address.
4. Enter a password of at least 12 characters.
5. Select **Create account**.

Trace signs you in through a secure HTTP-only cookie. The session credential is not stored in browser storage.

## Sign in

1. Open `/login`.
2. Enter your username and password.
3. Select **Sign in**.

If you reached login from a protected Trace page, successful sign-in returns you to that local page. Trace ignores unsafe external return links.

Possible messages include invalid credentials, a disabled account, too many attempts, temporary service unavailability, or a network failure. Server internals are not shown.

## Protected workspace

Dashboard, repositories, activity, reports, GitHub, and settings require a valid session. While Trace checks the session it displays **Verifying your secure session…** rather than briefly showing private workspace content.

If the session expires, Trace returns you to sign-in with the current local page preserved.

## Sign out

Select **Sign out** in the workspace header. Trace revokes the backend session using the current CSRF token and returns to `/login`.

## Forgot password

1. Open `/forgot-password`.
2. Enter a username or email address.
3. Select **Request reset**.

Trace always displays:

> If the account exists, password reset instructions have been sent.

This deliberately avoids revealing whether an account exists.

## Reset password

1. Open the reset link containing a valid `token` query parameter.
2. Enter a new password of at least 12 characters.
3. Select **Update password**.
4. Return to sign-in after the success message appears.

Reset links are single-use and expire after 30 minutes. A missing, invalid, consumed, or expired token displays a safe invalid-link message.

## Connect GitHub

1. Sign in to Trace and open **GitHub** in the workspace navigation.
2. Review the separate account-connection and App-installation sections. GitHub never replaces your Trace sign-in.
3. Select **Connect GitHub** or **Reconnect GitHub**. Trace follows only the secure GitHub URL supplied by its backend.
4. After returning, Trace shows safe connected, reconnect, denial, expired-session, or connection-error feedback without displaying OAuth or state details.
5. Connected users can review the linked GitHub username, installation owner, accessible repository count, and tracked repository count.
6. To disconnect, select **Disconnect GitHub**, review the confirmation, then select **Confirm disconnect**. Historical activity remains in Trace.

Repository rows on the GitHub page are labelled illustrative. Real repository access and tracking controls arrive in the repository-management work.

## Request and track reports

1. Open **Reports** in the protected workspace.
2. Choose the development-activity date. Trace displays the detected IANA timezone used for that request.
3. Select **Create report**.
4. Use report history to review **Pending**, **Processing**, **Completed**, or **Failed** status and open a detail view.
5. PDF download remains disabled until a later frontend delivery route is implemented, even if report metadata already references a current PDF artifact.

Reports now use Trace's authenticated live API. Creating a report sends the selected date and detected timezone with the in-memory CSRF token; Trace stores the authorized factual snapshot, queues generation, and returns persisted list/detail status after refresh. Duplicate dates, unavailable generation, expired sessions, empty history, load retries, and safe failures are handled without exposing internal errors. PDF controls remain disabled because frontend download delivery is not implemented yet; artifact metadata alone does not enable an inert control. Automated browser tests deterministically intercept the same validated HTTP contracts; the API integration suite separately proves PostgreSQL persistence, ownership, CSRF, and Redis publication.

## Accessibility

- Every field has a programmatic label.
- Validation messages are associated with their fields.
- Submission and error states are announced to assistive technology.
- Buttons are disabled during submission to prevent duplicate requests.
- Focus indicators and keyboard skip navigation are available.
- Motion is reduced when the operating system requests reduced motion.
