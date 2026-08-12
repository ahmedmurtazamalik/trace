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

## Accessibility

- Every field has a programmatic label.
- Validation messages are associated with their fields.
- Submission and error states are announced to assistive technology.
- Buttons are disabled during submission to prevent duplicate requests.
- Focus indicators and keyboard skip navigation are available.
- Motion is reduced when the operating system requests reduced motion.
