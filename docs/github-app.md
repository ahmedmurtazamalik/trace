# GitHub integration setup

Trace uses two separate GitHub integrations:

1. A GitHub OAuth App identifies users signing in to Trace through Auth.js.
2. A GitHub App grants read-only access to explicitly selected repositories and delivers repository webhooks.

These credentials serve different purposes and must not be interchanged.

## Development URLs

| Purpose | URL |
|---|---|
| Web application | `http://localhost:3000` |
| Auth.js GitHub callback | `http://localhost:3000/api/auth/callback/github` |
| GitHub App setup callback | `http://localhost:3000/api/github/install/callback` |
| GitHub App webhook | `https://<development-tunnel>/api/github/webhook` |

The webhook URL must be publicly reachable. It will be configured after a development tunnel is available.

## GitHub OAuth App

Create the development OAuth App under the developer's GitHub account.

Use:

- Application name: `Trace Development Login - NeoDym AI`
- Homepage URL: `http://localhost:3000`
- Authorization callback URL:
  `http://localhost:3000/api/auth/callback/github`
- Device Flow: disabled

The OAuth App is used only for user authentication. It must not be used to access connected repositories.

Store its credentials as:

- `AUTH_GITHUB_ID`
- `AUTH_GITHUB_SECRET`

Do not commit credential values.

## GitHub App

The development GitHub App provides repository access.

Use:

- Homepage URL: `http://localhost:3000`
- Setup URL:
  `http://localhost:3000/api/github/install/callback`
- Redirect on update: enabled
- Installation scope: any account
- OAuth during installation: disabled
- Webhook: inactive until a development tunnel is configured

### Repository permissions

| Permission | Access |
|---|---|
| Contents | Read-only |
| Metadata | Read-only |
| Pull requests | Read-only |

All account and organization permissions remain disabled.

### Webhook subscriptions

When the webhook endpoint is available, subscribe to:

- Push
- Pull request
- Installation
- Installation repositories

Generate a high-entropy webhook secret and configure it as
`GITHUB_APP_WEBHOOK_SECRET`.

### Credentials

The application requires:

- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_WEBHOOK_SECRET`

The downloaded private-key PEM file must be stored outside the repository.
Never commit PEM files, environment files, access tokens, client secrets, or
webhook secrets.

## Installation callback security

GitHub includes `installation_id` in the redirect to the setup URL. The server
must not trust this query parameter by itself. It must authenticate the Trace
user and retrieve the installation from GitHub before associating it with a
workspace.

## Webhook security

The webhook handler must:

1. Read the unmodified request body.
2. Enforce a request-size limit.
3. Validate the GitHub signature before parsing JSON.
4. Reject missing or invalid signatures.
5. Deduplicate deliveries using `X-GitHub-Delivery`.
6. Return quickly after durable receipt and bounded normalization.

## Environment handling

`.env.example` contains variable names only. Real development values belong in
an ignored local environment file and must be exchanged outside Git.