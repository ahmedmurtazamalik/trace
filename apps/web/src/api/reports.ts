import {
  apiErrorSchema, csrfHeaderName, reportArtifactSchema, reportCreateRequestSchema, reportCreateResponseSchema, reportDetailResponseSchema, reportDownloadQuerySchema, reportListQuerySchema, reportListResponseSchema, reportRegenerationRequestSchema, reportRegenerationResponseSchema, reportRevisionUpdateRequestSchema, reportRevisionUpdateResponseSchema,
  type ReportArtifact, type ReportCreateRequest, type ReportCreateResponse, type ReportDetailResponse, type ReportListQuery, type ReportListResponse, type ReportRegenerationRequest, type ReportRegenerationResponse, type ReportRevisionUpdateRequest, type ReportRevisionUpdateResponse,
} from "@trace/shared";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001").replace(/\/$/, "");
export type ReportClientCode = "UNAUTHENTICATED" | "NOT_FOUND" | "RATE_LIMITED" | "REPORT_NOT_FOUND" | "REPORT_ALREADY_EXISTS" | "REPORT_NOT_EDITABLE" | "REPORT_REVISION_CONFLICT" | "REPORT_ARTIFACT_NOT_FOUND" | "REPORT_GENERATION_UNAVAILABLE" | "INVALID_RESPONSE" | "NETWORK_ERROR" | "UNEXPECTED_ERROR";
const messages: Record<ReportClientCode, string> = {
  UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  NOT_FOUND: "The requested report feature is not available in the current backend.",
  RATE_LIMITED: "Too many report requests. Please wait and try again.",
  REPORT_NOT_FOUND: "This report is no longer available.",
  REPORT_ALREADY_EXISTS: "A report already exists for this date. Open it from report history.",
  REPORT_NOT_EDITABLE: "This report cannot be edited in its current state.",
  REPORT_REVISION_CONFLICT: "A newer revision exists. Reload it before editing again.",
  REPORT_ARTIFACT_NOT_FOUND: "This report file is unavailable or has expired. Refresh the report and try again.",
  REPORT_GENERATION_UNAVAILABLE: "Report generation is temporarily unavailable. Try again later.",
  INVALID_RESPONSE: "Trace received an invalid report response. Please try again.",
  NETWORK_ERROR: "Trace could not reach the server. Check your connection and try again.",
  UNEXPECTED_ERROR: "Trace could not complete the report request. Please try again.",
};
export class ReportApiError extends Error {
  readonly name = "ReportApiError";
  constructor(public readonly code: ReportClientCode, message: string, public readonly status: number, public readonly requestId?: string) { super(message); }
}

function reportApiError(payload: unknown, status: number): ReportApiError {
  const parsed = apiErrorSchema.safeParse(payload);
  const rawCode = parsed.success ? parsed.data.code : "";
  const candidate = rawCode === "UNAUTHORIZED" ? "UNAUTHENTICATED" : rawCode;
  const code: ReportClientCode = candidate in messages ? candidate as ReportClientCode : "UNEXPECTED_ERROR";
  return new ReportApiError(code, messages[code], status, parsed.success ? parsed.data.requestId : undefined);
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
  if (!response.ok) throw reportApiError(payload, response.status);
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
export async function updateReportRevision(id: string, input: ReportRevisionUpdateRequest, csrfToken: string, signal?: AbortSignal): Promise<ReportRevisionUpdateResponse> {
  if (!id || id.length > 256) throw new ReportApiError("UNEXPECTED_ERROR", messages.UNEXPECTED_ERROR, 0);
  const body = reportRevisionUpdateRequestSchema.parse(input);
  return request(`/api/v1/reports/${encodeURIComponent(id)}/revision`, { method: "PUT", headers: { "content-type": "application/json", [csrfHeaderName]: csrfToken }, body: JSON.stringify(body), signal }, reportRevisionUpdateResponseSchema) as Promise<ReportRevisionUpdateResponse>;
}

export async function regenerateReport(id: string, input: ReportRegenerationRequest, csrfToken: string, signal?: AbortSignal): Promise<ReportRegenerationResponse> {
  if (!id || id.length > 256) throw new ReportApiError("UNEXPECTED_ERROR", messages.UNEXPECTED_ERROR, 0);
  const body = reportRegenerationRequestSchema.parse(input);
  return request(`/api/v1/reports/${encodeURIComponent(id)}/regenerate`, { method: "POST", headers: { "content-type": "application/json", [csrfHeaderName]: csrfToken }, body: JSON.stringify(body), signal }, reportRegenerationResponseSchema) as Promise<ReportRegenerationResponse>;
}

export interface DownloadedReportArtifact { blob: Blob; fileName: string }

export async function downloadReportArtifact(id: string, input: ReportArtifact, signal?: AbortSignal): Promise<DownloadedReportArtifact> {
  if (!id || id.length > 256) throw new ReportApiError("UNEXPECTED_ERROR", messages.UNEXPECTED_ERROR, 0);
  const artifact = reportArtifactSchema.parse(input);
  const query = reportDownloadQuerySchema.parse({ artifactId: artifact.id });
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/api/v1/reports/${encodeURIComponent(id)}/download?${new URLSearchParams(query)}`, { method: "GET", credentials: "include", signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ReportApiError("NETWORK_ERROR", messages.NETWORK_ERROR, 0);
  }
  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = undefined; }
    throw reportApiError(payload, response.status);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const contentLength = response.headers.get("content-length");
  if (contentType !== artifact.contentType || (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) !== artifact.sizeBytes)) || !response.body) {
    throw new ReportApiError("INVALID_RESPONSE", messages.INVALID_RESPONSE, response.status);
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(artifact.sizeBytes);
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > artifact.sizeBytes) {
      await reader.cancel();
      throw new ReportApiError("INVALID_RESPONSE", messages.INVALID_RESPONSE, response.status);
    }
    bytes.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== artifact.sizeBytes) throw new ReportApiError("INVALID_RESPONSE", messages.INVALID_RESPONSE, response.status);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== artifact.checksum) throw new ReportApiError("INVALID_RESPONSE", messages.INVALID_RESPONSE, response.status);
  return { blob: new Blob([bytes.buffer], { type: artifact.contentType }), fileName: artifact.fileName };
}
