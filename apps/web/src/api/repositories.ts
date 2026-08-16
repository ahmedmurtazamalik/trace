import {
  apiErrorSchema,
  csrfHeaderName,
  repositoryDetailResponseSchema,
  repositoryErrorCodeSchema,
  repositoryListQuerySchema,
  repositoryListResponseSchema,
  repositorySynchronizationResponseSchema,
  repositoryTrackingResponseSchema,
  type RepositoryDetailResponse,
  type RepositoryErrorCode,
  type RepositoryListQuery,
  type RepositoryListResponse,
  type RepositorySynchronizationResponse,
  type RepositoryTrackingResponse,
} from "@trace/shared";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001").replace(/\/$/, "");

type ClientCode = RepositoryErrorCode | "UNAUTHENTICATED" | "CSRF_INVALID" | "VALIDATION_ERROR" | "RATE_LIMITED" | "SERVICE_UNAVAILABLE" | "INVALID_RESPONSE" | "NETWORK_ERROR" | "UNEXPECTED_ERROR";

const messages: Record<ClientCode, string> = {
  REPOSITORY_NOT_FOUND: "This repository is not available to your Trace account.",
  REPOSITORY_ACCESS_REMOVED: "GitHub access to this repository has been removed.",
  GITHUB_INSTALLATION_REQUIRED: "Connect GitHub and install the Trace GitHub App before synchronizing repositories.",
  GITHUB_INSTALLATION_SUSPENDED: "The GitHub App installation is suspended. Restore it before synchronizing repositories.",
  UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  CSRF_INVALID: "Your security session is no longer valid. Please sign in again.",
  VALIDATION_ERROR: "The repository request is invalid. Clear the filters and try again.",
  RATE_LIMITED: "Too many repository synchronization requests. Please wait and try again.",
  SERVICE_UNAVAILABLE: "Repository synchronization is temporarily unavailable. Please try again.",
  INVALID_RESPONSE: "Trace received an invalid repository response. Please try again.",
  NETWORK_ERROR: "Trace could not reach the server. Check your connection and try again.",
  UNEXPECTED_ERROR: "Trace could not complete the repository request. Please try again.",
};

export class RepositoryApiError extends Error {
  readonly name = "RepositoryApiError";
  constructor(public readonly code: ClientCode, message: string, public readonly status: number, public readonly requestId?: string) { super(message); }
}

interface Schema<T> { safeParse(value: unknown): { success: true; data: T } | { success: false } }
interface Options { signal?: AbortSignal }

async function request<T>(path: string, method: "GET" | "POST" | "DELETE", schema: Schema<T>, options: Options = {}, csrfToken?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      credentials: "include",
      headers: csrfToken === undefined ? undefined : { [csrfHeaderName]: csrfToken },
      body: undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new RepositoryApiError("NETWORK_ERROR", messages.NETWORK_ERROR, 0);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (!parsed.success) throw new RepositoryApiError("UNEXPECTED_ERROR", messages.UNEXPECTED_ERROR, response.status);
    const repositoryCode = repositoryErrorCodeSchema.safeParse(parsed.data.code);
    const code = repositoryCode.success ? repositoryCode.data : parsed.data.code in messages ? parsed.data.code as ClientCode : "UNEXPECTED_ERROR";
    throw new RepositoryApiError(code, messages[code], response.status, parsed.data.requestId);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new RepositoryApiError("INVALID_RESPONSE", messages.INVALID_RESPONSE, response.status);
  return parsed.data;
}

export function listRepositories(input: Partial<RepositoryListQuery> = {}, options: Options = {}): Promise<RepositoryListResponse> {
  const query = repositoryListQuerySchema.parse(input);
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.search !== undefined) params.set("search", query.search);
  const suffix = params.size === 0 ? "" : `?${params.toString()}`;
  return request(`/api/v1/repositories${suffix}`, "GET", repositoryListResponseSchema, options);
}

export function getRepository(id: string, options: Options = {}): Promise<RepositoryDetailResponse> {
  return request(`/api/v1/repositories/${encodeURIComponent(id)}`, "GET", repositoryDetailResponseSchema, options);
}

export function synchronizeRepositories(csrfToken: string, options: Options = {}): Promise<RepositorySynchronizationResponse> {
  return request("/api/v1/repositories/sync", "POST", repositorySynchronizationResponseSchema, options, csrfToken);
}

export function setRepositoryTracking(id: string, enabled: boolean, csrfToken: string, options: Options = {}): Promise<RepositoryTrackingResponse> {
  return request(`/api/v1/repositories/${encodeURIComponent(id)}/tracking`, enabled ? "POST" : "DELETE", repositoryTrackingResponseSchema, options, csrfToken);
}
