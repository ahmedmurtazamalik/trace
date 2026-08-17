# GitHub App setup

Trace uses a GitHub App for repository installation access and push webhooks, plus the App's OAuth credentials to bind a Trace user to a GitHub identity. Users never paste personal access tokens.

## Create the App

Create a GitHub App owned by the intended personal account or organization. Record its numeric App ID and URL slug as `GITHUB_APP_ID` and `GITHUB_APP_SLUG`.

Set the user authorization callback URL to the public API route:

```text
https://API_HOST/api/v1/github/callback
```

Set the installation callback URL to:

```text
https://API_HOST/api/v1/github/installation/callback
```

Set the webhook URL to:

```text
https://API_HOST/api/v1/webhooks/github
```

The callback environment values must match the public HTTPS URLs exactly. Do not register localhost or HTTP callbacks for production.

## Permissions and events

Grant only the repository access Trace currently needs:

- **Metadata:** read-only (required by GitHub and used for repository identity).
- **Contents:** read-only (repository and commit synchronization).

Subscribe to the **Push** repository event. Trace's webhook endpoint validates and processes push payloads; do not subscribe unrelated events unless the backend first adds an explicit validated handler.

Install the App only on repositories Trace should be able to list. End users choose which synchronized repositories they actually track inside Trace.

## Credentials

Generate a private key and store the PEM in the deployment secret manager as `GITHUB_APP_PRIVATE_KEY`. Literal PEM newlines or escaped `\\n` are accepted. Never commit or paste the private key into logs, tickets, shell history, or frontend configuration.

Use the App's OAuth client ID and client secret as `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`. Generate a random webhook secret of at least 32 characters and configure the same value in GitHub and `GITHUB_WEBHOOK_SECRET`.

The API also requires `GITHUB_CALLBACK_URL` and `GITHUB_INSTALLATION_CALLBACK_URL`; the worker requires the App ID and private key to obtain installation-scoped credentials.

## Validate the flow

1. Start from an authenticated Trace session.
2. Initiate GitHub account connection in Trace and complete the OAuth callback.
3. Start App installation, choose a personal account or organization, and complete the installation callback.
4. Confirm Trace reports the installation as active and synchronizes only repositories visible to that installation.
5. Enable tracking for a test repository.
6. Push a test commit and verify GitHub reports a successful webhook delivery.
7. Correlate the delivery ID with Trace's durable webhook processing without recording the signature or payload in logs.
8. Suspend or remove access in a non-production test installation and verify Trace fails closed and retains historical data.

## Rotation and incident response

- Add and deploy a new App private key before revoking the old key.
- Coordinate webhook-secret changes so GitHub and the API switch together; failed signatures must remain rejected.
- Rotate the OAuth client secret through the secret manager and restart the API.
- If a private key or OAuth secret is exposed, revoke it in GitHub immediately, rotate the deployment secret, restart affected services, and review GitHub App and Trace audit history.
- If webhook deliveries fail, inspect GitHub's delivery status, HTTP code, sanitized Trace request ID, and queue/database status. Never disable signature verification as a diagnostic shortcut.
