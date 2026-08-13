import {
  activityListQuerySchema,
  activityListResponseSchema,
  apiErrorSchema,
  type ActivityListQuery,
  type ActivityListResponse,
} from "@trace/shared";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001").replace(/\/$/, "");

export type ActivityClientCode = "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION_ERROR" | "SERVICE_UNAVAILABLE" | "INVALID_RESPONSE" | "NETWORK_ERROR" | "UNEXPECTED_ERROR";

const messages: Record<ActivityClientCode, string> = {
  UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  FORBIDDEN: "You do not have permission to view this activity.",
  VALIDATION_ERROR: "The activity filters are invalid. Clear them and try again.",
  SERVICE_UNAVAILABLE: "Development activity is temporarily unavailable. Please try again.",
  INVALID_RESPONSE: "Trace received an invalid activity response. Please try again.",
  NETWORK_ERROR: "Trace could not reach the server. Check your connection and try again.",
  UNEXPECTED_ERROR: "Trace could not load development activity. Please try again.",
};

export class ActivityApiError extends Error {
  readonly name = "ActivityApiError";
  constructor(public readonly code: ActivityClientCode, message: string, public readonly status: number, public readonly requestId?: string) { super(message); }
}

export interface ActivityRequestOptions { signal?: AbortSignal }

function queryString(input: Partial<ActivityListQuery>) {
  const query = activityListQuerySchema.parse(input);
  const params = new URLSearchParams();
  const values: Array<[string, string | number | undefined]> = [
    ["date", query.date],
    ["timezone", query.timezone],
    ["repositoryId", query.repositoryId],
    ["contributorId", query.contributorId],
    ["source", query.source],
    ["type", query.type],
    ["cursor", query.cursor],
    ["limit", query.limit],
  ];
  for (const [key, value] of values) if (value !== undefined) params.set(key, String(value));
  return params.toString();
}

async function request(path: string, options: ActivityRequestOptions): Promise<ActivityListResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, { method: "GET", credentials: "include", signal: options.signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ActivityApiError("NETWORK_ERROR", messages.NETWORK_ERROR, 0);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (!parsed.success) throw new ActivityApiError("UNEXPECTED_ERROR", messages.UNEXPECTED_ERROR, response.status);
    const candidate = parsed.data.code === "UNAUTHORIZED" ? "UNAUTHENTICATED" : parsed.data.code;
    const code: ActivityClientCode = candidate in messages ? candidate as ActivityClientCode : response.status === 403 ? "FORBIDDEN" : "UNEXPECTED_ERROR";
    throw new ActivityApiError(code, messages[code], response.status, parsed.data.requestId);
  }
  const parsed = activityListResponseSchema.safeParse(payload);
  if (!parsed.success) throw new ActivityApiError("INVALID_RESPONSE", messages.INVALID_RESPONSE, response.status);
  return parsed.data;
}

export function listActivity(input: Partial<ActivityListQuery> = {}, options: ActivityRequestOptions = {}) {
  return request(`/api/v1/activity?${queryString(input)}`, options);
}

export function listRepositoryActivity(repositoryId: string, input: Partial<ActivityListQuery> = {}, options: ActivityRequestOptions = {}) {
  return request(`/api/v1/repositories/${encodeURIComponent(repositoryId)}/activity?${queryString(input)}`, options);
}
