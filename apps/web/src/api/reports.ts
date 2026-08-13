import {
  apiErrorSchema, csrfHeaderName, reportCreateRequestSchema, reportCreateResponseSchema, reportDetailResponseSchema, reportListQuerySchema, reportListResponseSchema,
  type ReportCreateRequest, type ReportCreateResponse, type ReportDetailResponse, type ReportListQuery, type ReportListResponse,
} from "@trace/shared";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001").replace(/\/$/, "");
export type ReportClientCode = "UNAUTHENTICATED" | "REPORT_ALREADY_EXISTS" | "REPORT_GENERATION_UNAVAILABLE" | "INVALID_RESPONSE" | "NETWORK_ERROR" | "UNEXPECTED_ERROR";
const messages: Record<ReportClientCode, string> = {
  UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  REPORT_ALREADY_EXISTS: "A report already exists for this date. Open it from report history.",
  REPORT_GENERATION_UNAVAILABLE: "Report generation is temporarily unavailable. Try again later.",
  INVALID_RESPONSE: "Trace received an invalid report response. Please try again.",
  NETWORK_ERROR: "Trace could not reach the server. Check your connection and try again.",
  UNEXPECTED_ERROR: "Trace could not complete the report request. Please try again.",
};
export class ReportApiError extends Error {
  readonly name = "ReportApiError";
  constructor(public readonly code: ReportClientCode, message: string, public readonly status: number, public readonly requestId?: string) { super(message); }
}

async function request(url: string, init: RequestInit, schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } }) {
  let response: Response;
  try { response = await fetch(`${API_ORIGIN}${url}`, { ...init, credentials: "include" }); }
  catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ReportApiError("NETWORK_ERROR", messages.NETWORK_ERROR, 0);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    const rawCode = parsed.success ? parsed.data.code : "";
    const candidate = rawCode === "UNAUTHORIZED" ? "UNAUTHENTICATED" : rawCode;
    const code: ReportClientCode = candidate in messages ? candidate as ReportClientCode : "UNEXPECTED_ERROR";
    throw new ReportApiError(code, messages[code], response.status, parsed.success ? parsed.data.requestId : undefined);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ReportApiError("INVALID_RESPONSE", messages.INVALID_RESPONSE, response.status);
  return parsed.data;
}

export async function listReports(input: ReportListQuery, signal?: AbortSignal): Promise<ReportListResponse> {
  const query = reportListQuerySchema.parse(input);
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.status) params.set("status", query.status);
  return request(`/api/v1/reports?${params}`, { method: "GET", signal }, reportListResponseSchema) as Promise<ReportListResponse>;
}
export async function createReport(input: ReportCreateRequest, csrfToken: string, signal?: AbortSignal): Promise<ReportCreateResponse> {
  const body = reportCreateRequestSchema.parse(input);
  return request("/api/v1/reports", { method: "POST", headers: { "content-type": "application/json", [csrfHeaderName]: csrfToken }, body: JSON.stringify(body), signal }, reportCreateResponseSchema) as Promise<ReportCreateResponse>;
}
export async function getReport(id: string, signal?: AbortSignal): Promise<ReportDetailResponse> {
  if (!id || id.length > 256) throw new ReportApiError("UNEXPECTED_ERROR", messages.UNEXPECTED_ERROR, 0);
  return request(`/api/v1/reports/${encodeURIComponent(id)}`, { method: "GET", signal }, reportDetailResponseSchema) as Promise<ReportDetailResponse>;
}
