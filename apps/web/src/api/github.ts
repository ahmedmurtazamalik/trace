import {
  apiErrorSchema,
  csrfHeaderName,
  githubConnectResponseSchema,
  githubConnectionStatusSchema,
  githubDisconnectResponseSchema,
  githubErrorCodeSchema,
  githubInstallationStartResponseSchema,
  type GithubConnectResponse,
  type GithubConnectionStatus,
  type GithubDisconnectResponse,
  type GithubErrorCode,
  type GithubInstallationStartResponse,
} from "@trace/shared";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001").replace(/\/$/, "");

type GithubClientErrorCode = GithubErrorCode | "UNAUTHENTICATED" | "CSRF_INVALID" | "RATE_LIMITED" | "SERVICE_UNAVAILABLE" | "INVALID_RESPONSE" | "NETWORK_ERROR" | "UNEXPECTED_ERROR";

const safeMessages: Record<GithubClientErrorCode, string> = {
  GITHUB_STATE_INVALID: "This GitHub connection request is no longer valid. Please start again.",
  GITHUB_CALLBACK_FAILED: "GitHub could not complete the connection. Please try again.",
  GITHUB_NOT_CONNECTED: "GitHub is already disconnected.",
  GITHUB_RECONNECT_REQUIRED: "GitHub needs to be reconnected before Trace can continue.",
  GITHUB_INSTALLATION_REQUIRED: "Install the Trace GitHub App to choose repositories.",
  GITHUB_INSTALLATION_SUSPENDED: "The GitHub App installation is suspended. Restore it in GitHub to continue.",
  UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  CSRF_INVALID: "Your security session is no longer valid. Please sign in again.",
  RATE_LIMITED: "Too many attempts. Please wait and try again.",
  SERVICE_UNAVAILABLE: "GitHub integration is temporarily unavailable. Please try again later.",
  INVALID_RESPONSE: "Trace received an invalid GitHub response. Please try again.",
  NETWORK_ERROR: "Trace could not reach the server. Check your connection and try again.",
  UNEXPECTED_ERROR: "Trace could not complete the GitHub request. Please try again.",
};

export class GithubApiError extends Error {
  readonly name = "GithubApiError";
  constructor(public readonly code: GithubClientErrorCode, message: string, public readonly status: number, public readonly requestId?: string) {
    super(message);
  }
}

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

interface RequestOptions { signal?: AbortSignal }

async function request<T>(path: string, method: "GET" | "DELETE", schema: Schema<T>, options: RequestOptions = {}, headers?: Record<string, string>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, { method, credentials: "include", headers, body: undefined, signal: options.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new GithubApiError("NETWORK_ERROR", safeMessages.NETWORK_ERROR, 0);
  }

  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (!parsed.success) throw new GithubApiError("UNEXPECTED_ERROR", safeMessages.UNEXPECTED_ERROR, response.status);
    const githubCode = githubErrorCodeSchema.safeParse(parsed.data.code);
    const code = githubCode.success
      ? githubCode.data
      : parsed.data.code in safeMessages
        ? parsed.data.code as GithubClientErrorCode
        : "UNEXPECTED_ERROR";
    throw new GithubApiError(code, safeMessages[code], response.status, parsed.data.requestId);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new GithubApiError("INVALID_RESPONSE", safeMessages.INVALID_RESPONSE, response.status);
  return parsed.data;
}

/** Reads account connection and GitHub App installation as separate states. */
export function getGithubStatus(options: RequestOptions = {}): Promise<GithubConnectionStatus> {
  return request("/api/v1/github/status", "GET", githubConnectionStatusSchema, options);
}

/** Requests a backend-generated, contract-validated github.com authorization URL. */
export function connectGithub(options: RequestOptions = {}): Promise<GithubConnectResponse> {
  return request("/api/v1/github/connect", "GET", githubConnectResponseSchema, options);
}

/** Requests the backend-generated GitHub App installation URL. */
export function getGithubInstallation(options: RequestOptions = {}): Promise<GithubInstallationStartResponse> {
  return request("/api/v1/github/installation", "GET", githubInstallationStartResponseSchema, options);
}

/** Disconnects GitHub without deleting retained Trace activity. */
export function disconnectGithub(csrfToken: string, options: RequestOptions = {}): Promise<GithubDisconnectResponse> {
  return request("/api/v1/github/connection", "DELETE", githubDisconnectResponseSchema, options, { [csrfHeaderName]: csrfToken });
}
