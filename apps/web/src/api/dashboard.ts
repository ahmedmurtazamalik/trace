import { apiErrorSchema, dashboardQuerySchema, dashboardResponseSchema, type DashboardQuery, type DashboardResponse } from "@trace/shared";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001").replace(/\/$/, "");
export type DashboardClientCode = "UNAUTHENTICATED" | "FORBIDDEN" | "REPOSITORY_NOT_FOUND" | "VALIDATION_ERROR" | "SERVICE_UNAVAILABLE" | "INVALID_RESPONSE" | "NETWORK_ERROR" | "UNEXPECTED_ERROR";
const messages: Record<DashboardClientCode, string> = {
  UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  FORBIDDEN: "You do not have permission to view this dashboard.",
  REPOSITORY_NOT_FOUND: "The selected repository is no longer available. Show all repositories to continue.",
  VALIDATION_ERROR: "The dashboard filters are invalid. Clear them and try again.",
  SERVICE_UNAVAILABLE: "The dashboard is temporarily unavailable. Please try again.",
  INVALID_RESPONSE: "Trace received an invalid dashboard response. Please try again.",
  NETWORK_ERROR: "Trace could not reach the server. Check your connection and try again.",
  UNEXPECTED_ERROR: "Trace could not load the dashboard. Please try again.",
};
export class DashboardApiError extends Error {
  readonly name = "DashboardApiError";
  constructor(public readonly code: DashboardClientCode, message: string, public readonly status: number, public readonly requestId?: string) { super(message); }
}
export interface DashboardRequestOptions { signal?: AbortSignal }

export async function getDashboard(input: DashboardQuery, options: DashboardRequestOptions = {}): Promise<DashboardResponse> {
  const query = dashboardQuerySchema.parse(input);
  const params = new URLSearchParams({ date: query.date, timezone: query.timezone });
  if (query.repositoryId !== undefined) params.set("repositoryId", query.repositoryId);
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/api/v1/dashboard?${params.toString()}`, { method: "GET", credentials: "include", signal: options.signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new DashboardApiError("NETWORK_ERROR", messages.NETWORK_ERROR, 0);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (!parsed.success) throw new DashboardApiError("UNEXPECTED_ERROR", messages.UNEXPECTED_ERROR, response.status);
    const candidate = parsed.data.code === "UNAUTHORIZED" ? "UNAUTHENTICATED" : parsed.data.code;
    const code: DashboardClientCode = candidate in messages ? candidate as DashboardClientCode : response.status === 403 ? "FORBIDDEN" : "UNEXPECTED_ERROR";
    throw new DashboardApiError(code, messages[code], response.status, parsed.data.requestId);
  }
  const parsed = dashboardResponseSchema.safeParse(payload);
  if (!parsed.success) throw new DashboardApiError("INVALID_RESPONSE", messages.INVALID_RESPONSE, response.status);
  return parsed.data;
}
