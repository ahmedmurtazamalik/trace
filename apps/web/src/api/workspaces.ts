import {
  apiErrorSchema,
  csrfHeaderName,
  reportArtifactSchema,
  workspaceReportDetailResponseSchema,
  reportDownloadQuerySchema,
  reportErrorCodeSchema,
  reportListQuerySchema,
  reportListResponseSchema,
  reportRegenerationRequestSchema,
  reportRegenerationResponseSchema,
  reportRevisionUpdateRequestSchema,
  reportRevisionUpdateResponseSchema,
  workspaceAssignRepositoryRequestSchema,
  workspaceCreateRequestSchema,
  workspaceCreateResponseSchema,
  workspaceDetailResponseSchema,
  workspaceErrorCodeSchema,
  workspaceListResponseSchema,
  workspaceAnalysisResponseSchema,
  workspaceAnalysisStartResponseSchema,
  workspaceMemberRemovalResponseSchema,
  workspaceMemberRoleUpdateRequestSchema,
  workspaceMembershipResponseSchema,
  workspaceInvitationCreateRequestSchema,
  workspaceInvitationCreateResponseSchema,
  workspaceInvitationAcceptResponseSchema,
  workspaceInvitationDecisionResponseSchema,
  workspaceInvitationDetailResponseSchema,
  workspaceInvitationListResponseSchema,
  workspaceRepositoryAssignmentResponseSchema,
  workspaceRepositoryRemovalResponseSchema,
  workspaceUpdateRequestSchema,
  workspaceReportGenerateRequestSchema,
  workspaceReportGenerateResponseSchema,
  workspaceReportOccurrenceListResponseSchema,
  workspaceReportScheduleRequestSchema,
  workspaceReportScheduleResponseSchema,
  type WorkspaceArchiveResponse,
  type WorkspaceAssignRepositoryRequest,
  type WorkspaceCreateRequest,
  type WorkspaceCreateResponse,
  type WorkspaceDetailResponse,
  type WorkspaceErrorCode,
  type WorkspaceListResponse,
  type WorkspaceAnalysisResponse,
  type WorkspaceAnalysisStartResponse,
  type WorkspaceMemberRemovalResponse,
  type WorkspaceMemberRoleUpdateRequest,
  type WorkspaceMembershipResponse,
  type WorkspaceInvitationCreateRequest,
  type WorkspaceInvitationCreateResponse,
  type WorkspaceInvitationAcceptResponse,
  type WorkspaceInvitationDecisionResponse,
  type WorkspaceInvitationDetailResponse,
  type WorkspaceInvitationListResponse,
  type WorkspaceRepositoryAssignmentResponse,
  type WorkspaceRepositoryRemovalResponse,
  type WorkspaceUpdateRequest,
  type WorkspaceUpdateResponse,
  type WorkspaceReportGenerateRequest,
  type WorkspaceReportGenerateResponse,
  type WorkspaceReportOccurrenceListResponse,
  type WorkspaceReportScheduleRequest,
  type WorkspaceReportScheduleResponse,
  type ReportArtifact,
  type WorkspaceReportDetailResponse,
  type ReportErrorCode,
  type ReportListQuery,
  type ReportListResponse,
  type ReportRegenerationRequest,
  type ReportRegenerationResponse,
  type ReportRevisionUpdateRequest,
  type ReportRevisionUpdateResponse,
} from '@trace/shared';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:3001').replace(/\/$/, '');

type ClientCode = WorkspaceErrorCode | ReportErrorCode | 'WORKSPACE_REPOSITORY_ACCESS_REMOVED' | 'WORKSPACE_IDEMPOTENCY_CONFLICT' | 'WORKSPACE_REPORT_TOO_LARGE' | 'UNAUTHENTICATED' | 'CSRF_INVALID' | 'VALIDATION_ERROR' | 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE' | 'INVALID_RESPONSE' | 'NETWORK_ERROR' | 'UNEXPECTED_ERROR';

const messages: Record<ClientCode, string> = {
  WORKSPACE_NOT_FOUND: 'This workspace is not available to your Trace account.',
  WORKSPACE_MANAGER_REQUIRED: 'Only workspace managers can change members or repositories.',
  WORKSPACE_ARCHIVED: 'This workspace is archived and read-only.',
  WORKSPACE_MEMBER_NOT_FOUND: 'That active Trace user could not be added to this workspace.',
  WORKSPACE_REPOSITORY_NOT_AVAILABLE: 'Choose a repository currently available to your Trace account.',
  WORKSPACE_REPOSITORY_NOT_ASSIGNED: 'That repository is not assigned to this workspace.',
  WORKSPACE_REPOSITORY_ACCESS_REMOVED: 'GitHub access to this workspace repository is unavailable.',
  WORKSPACE_IDEMPOTENCY_CONFLICT: 'That report request conflicts with an earlier request. Try again.',
  WORKSPACE_REPORT_TOO_LARGE: 'This report window contains too much activity. Choose a shorter window.',
  WORKSPACE_MEMBER_EXISTS: 'That person is already a workspace member.',
  WORKSPACE_LAST_MANAGER_REQUIRED: 'A workspace must retain at least one Manager.',
  WORKSPACE_INVITATION_NOT_FOUND: 'This workspace invitation is no longer available.',
  WORKSPACE_INVITATION_EXISTS: 'A pending invitation already exists for that person.',
  WORKSPACE_INVITATION_EXPIRED: 'This workspace invitation has expired.',
  WORKSPACE_INVITATION_NOT_PENDING: 'This workspace invitation has already been resolved.',
  WORKSPACE_INVITATION_TARGET_INVALID: 'This workspace invitation is not available to your Trace account.',
  REPORT_NOT_FOUND: 'This workspace report is no longer available.',
  REPORT_ALREADY_EXISTS: 'A report already exists for this date.',
  REPORT_NOT_EDITABLE: 'This workspace report cannot be edited in its current state.',
  REPORT_REVISION_CONFLICT: 'A newer revision exists. Reload it before editing again.',
  REPORT_ARTIFACT_NOT_FOUND: 'This report file is unavailable or has expired. Refresh the report and try again.',
  REPORT_GENERATION_UNAVAILABLE: 'Report generation is temporarily unavailable. Try again later.',
  UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
  CSRF_INVALID: 'Your security session is no longer valid. Please sign in again.',
  VALIDATION_ERROR: 'Check the workspace information and try again.',
  RATE_LIMITED: 'Too many workspace requests. Please wait and try again.',
  SERVICE_UNAVAILABLE: 'Workspaces are temporarily unavailable. Please try again.',
  INVALID_RESPONSE: 'Trace received an invalid workspace response. Please try again.',
  NETWORK_ERROR: 'Trace could not reach the server. Check your connection and try again.',
  UNEXPECTED_ERROR: 'Trace could not complete the workspace request. Please try again.',
};

export class WorkspaceApiError extends Error {
  readonly name = 'WorkspaceApiError';
  constructor(public readonly code: ClientCode, message: string, public readonly status: number, public readonly requestId?: string) { super(message); }
}

interface Schema<T> { safeParse(value: unknown): { success: true; data: T } | { success: false } }
export interface WorkspaceRequestOptions { signal?: AbortSignal }
type Options = WorkspaceRequestOptions;

async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', schema: Schema<T>, options: Options = {}, csrfToken?: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined
        ? (csrfToken === undefined && Object.keys(extraHeaders).length === 0 ? undefined : { ...(csrfToken === undefined ? {} : { [csrfHeaderName]: csrfToken }), ...extraHeaders })
        : { 'content-type': 'application/json', ...(csrfToken === undefined ? {} : { [csrfHeaderName]: csrfToken }), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new WorkspaceApiError('NETWORK_ERROR', messages.NETWORK_ERROR, 0);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (!parsed.success) throw new WorkspaceApiError('UNEXPECTED_ERROR', messages.UNEXPECTED_ERROR, response.status);
    const rawCode = parsed.data.code === 'UNAUTHORIZED' ? 'UNAUTHENTICATED' : parsed.data.code;
    const workspaceCode = workspaceErrorCodeSchema.safeParse(rawCode);
    const reportCode = reportErrorCodeSchema.safeParse(rawCode);
    const code = workspaceCode.success ? workspaceCode.data : reportCode.success ? reportCode.data : rawCode in messages ? rawCode as ClientCode : 'UNEXPECTED_ERROR';
    throw new WorkspaceApiError(code, messages[code], response.status, parsed.data.requestId);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new WorkspaceApiError('INVALID_RESPONSE', messages.INVALID_RESPONSE, response.status);
  return parsed.data;
}

export function listWorkspaces(options: Options = {}): Promise<WorkspaceListResponse> {
  return request('/api/v1/workspaces', 'GET', workspaceListResponseSchema, options);
}

export function getWorkspace(id: string, options: Options = {}): Promise<WorkspaceDetailResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}`, 'GET', workspaceDetailResponseSchema, options);
}

export function createWorkspace(input: WorkspaceCreateRequest, csrfToken: string, options: Options = {}): Promise<WorkspaceCreateResponse> {
  const body = workspaceCreateRequestSchema.parse(input);
  return request('/api/v1/workspaces', 'POST', workspaceCreateResponseSchema, options, csrfToken, body);
}

export function createWorkspaceInvitation(id: string, input: WorkspaceInvitationCreateRequest, csrfToken: string, options: Options = {}): Promise<WorkspaceInvitationCreateResponse> {
  const body = workspaceInvitationCreateRequestSchema.parse(input);
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/invitations`, 'POST', workspaceInvitationCreateResponseSchema, options, csrfToken, body);
}

export function listWorkspaceInvitations(id: string, options: Options = {}): Promise<WorkspaceInvitationListResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/invitations`, 'GET', workspaceInvitationListResponseSchema, options);
}

export function listMyWorkspaceInvitations(options: Options = {}): Promise<WorkspaceInvitationListResponse> {
  return request('/api/v1/workspace-invitations', 'GET', workspaceInvitationListResponseSchema, options);
}

export function getWorkspaceInvitation(invitationId: string, tokenOrOptions?: string | Options, options: Options = {}): Promise<WorkspaceInvitationDetailResponse> {
  const token = typeof tokenOrOptions === 'string' ? tokenOrOptions : undefined;
  const requestOptions = typeof tokenOrOptions === 'string' ? options : tokenOrOptions ?? {};
  return request(
    `/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}`,
    'GET',
    workspaceInvitationDetailResponseSchema,
    requestOptions,
    undefined,
    undefined,
    token === undefined ? {} : { 'x-workspace-invitation-token': token },
  );
}

export function acceptWorkspaceInvitation(invitationId: string, csrfToken: string, tokenOrOptions?: string | Options, options: Options = {}): Promise<WorkspaceInvitationAcceptResponse> {
  const token = typeof tokenOrOptions === 'string' ? tokenOrOptions : undefined;
  const requestOptions = typeof tokenOrOptions === 'string' ? options : tokenOrOptions ?? {};
  return request(
    `/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}/accept`,
    'POST',
    workspaceInvitationAcceptResponseSchema,
    requestOptions,
    csrfToken,
    undefined,
    token === undefined ? {} : { 'x-workspace-invitation-token': token },
  );
}

export function declineWorkspaceInvitation(invitationId: string, csrfToken: string, tokenOrOptions?: string | Options, options: Options = {}): Promise<WorkspaceInvitationDecisionResponse> {
  const token = typeof tokenOrOptions === 'string' ? tokenOrOptions : undefined;
  const requestOptions = typeof tokenOrOptions === 'string' ? options : tokenOrOptions ?? {};
  return request(
    `/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}/decline`,
    'POST',
    workspaceInvitationDecisionResponseSchema,
    requestOptions,
    csrfToken,
    undefined,
    token === undefined ? {} : { 'x-workspace-invitation-token': token },
  );
}

export function revokeWorkspaceInvitation(id: string, invitationId: string, csrfToken: string, options: Options = {}): Promise<WorkspaceInvitationDecisionResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/invitations/${encodeURIComponent(invitationId)}/revoke`, 'POST', workspaceInvitationDecisionResponseSchema, options, csrfToken);
}

export function assignWorkspaceRepository(id: string, input: WorkspaceAssignRepositoryRequest, csrfToken: string, options: Options = {}): Promise<WorkspaceRepositoryAssignmentResponse> {
  const body = workspaceAssignRepositoryRequestSchema.parse(input);
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/repositories`, 'POST', workspaceRepositoryAssignmentResponseSchema, options, csrfToken, body);
}

export function updateWorkspace(id: string, input: WorkspaceUpdateRequest, csrfToken: string, options: Options = {}): Promise<WorkspaceUpdateResponse> {
  const body = workspaceUpdateRequestSchema.parse(input);
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}`, 'PATCH', workspaceCreateResponseSchema, options, csrfToken, body);
}

export function archiveWorkspace(id: string, csrfToken: string, options: Options = {}): Promise<WorkspaceArchiveResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/archive`, 'POST', workspaceCreateResponseSchema, options, csrfToken);
}

export function updateWorkspaceMemberRole(id: string, userId: string, input: WorkspaceMemberRoleUpdateRequest, csrfToken: string, options: Options = {}): Promise<WorkspaceMembershipResponse> {
  const body = workspaceMemberRoleUpdateRequestSchema.parse(input);
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, 'PATCH', workspaceMembershipResponseSchema, options, csrfToken, body);
}

export function removeWorkspaceMember(id: string, userId: string, csrfToken: string, options: Options = {}): Promise<WorkspaceMemberRemovalResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, 'DELETE', workspaceMemberRemovalResponseSchema, options, csrfToken);
}

export function removeWorkspaceRepository(id: string, repositoryId: string, csrfToken: string, options: Options = {}): Promise<WorkspaceRepositoryRemovalResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/repositories/${encodeURIComponent(repositoryId)}`, 'DELETE', workspaceRepositoryRemovalResponseSchema, options, csrfToken);
}

export function getWorkspaceAnalysis(id: string, options: Options = {}): Promise<WorkspaceAnalysisResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/analysis`, 'GET', workspaceAnalysisResponseSchema, options);
}

export function startWorkspaceBaseline(id: string, repositoryId: string, csrfToken: string, options: Options = {}): Promise<WorkspaceAnalysisStartResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/repositories/${encodeURIComponent(repositoryId)}/baseline`, 'POST', workspaceAnalysisStartResponseSchema, options, csrfToken);
}

export function generateWorkspaceReport(id: string, input: WorkspaceReportGenerateRequest, idempotencyKey: string, csrfToken: string, options: Options = {}): Promise<WorkspaceReportGenerateResponse> {
  const body = workspaceReportGenerateRequestSchema.parse(input);
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/reports/generate`, 'POST', workspaceReportGenerateResponseSchema, options, csrfToken, body, { 'idempotency-key': idempotencyKey });
}

export function getWorkspaceReportSchedule(id: string, options: Options = {}): Promise<WorkspaceReportScheduleResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/report-schedule`, 'GET', workspaceReportScheduleResponseSchema, options);
}

export function updateWorkspaceReportSchedule(id: string, input: WorkspaceReportScheduleRequest, csrfToken: string, options: Options = {}): Promise<WorkspaceReportScheduleResponse> {
  const body = workspaceReportScheduleRequestSchema.parse(input);
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/report-schedule`, 'PUT', workspaceReportScheduleResponseSchema, options, csrfToken, body);
}

export function disableWorkspaceReportSchedule(id: string, csrfToken: string, options: Options = {}): Promise<WorkspaceReportScheduleResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/report-schedule`, 'DELETE', workspaceReportScheduleResponseSchema, options, csrfToken);
}

export function listWorkspaceReportOccurrences(id: string, options: Options = {}): Promise<WorkspaceReportOccurrenceListResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/report-occurrences`, 'GET', workspaceReportOccurrenceListResponseSchema, options);
}

export function listWorkspaceReports(id: string, input: ReportListQuery, options: Options = {}): Promise<ReportListResponse> {
  const query = reportListQuerySchema.parse(input);
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.status) params.set('status', query.status);
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/reports?${params}`, 'GET', reportListResponseSchema, options);
}

export function getWorkspaceReport(id: string, reportId: string, options: Options = {}): Promise<WorkspaceReportDetailResponse> {
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/reports/${encodeURIComponent(reportId)}`, 'GET', workspaceReportDetailResponseSchema, options);
}

export function updateWorkspaceReportRevision(id: string, reportId: string, input: ReportRevisionUpdateRequest, csrfToken: string, options: Options = {}): Promise<ReportRevisionUpdateResponse> {
  const body = reportRevisionUpdateRequestSchema.parse(input);
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/reports/${encodeURIComponent(reportId)}/revision`, 'PUT', reportRevisionUpdateResponseSchema, options, csrfToken, body);
}

export function regenerateWorkspaceReport(id: string, reportId: string, input: ReportRegenerationRequest, csrfToken: string, options: Options = {}): Promise<ReportRegenerationResponse> {
  const body = reportRegenerationRequestSchema.parse(input);
  return request(`/api/v1/workspaces/${encodeURIComponent(id)}/reports/${encodeURIComponent(reportId)}/regenerate`, 'POST', reportRegenerationResponseSchema, options, csrfToken, body);
}

export interface DownloadedWorkspaceReportArtifact { blob: Blob; fileName: string }

export async function downloadWorkspaceReportArtifact(id: string, reportId: string, input: ReportArtifact, options: Options = {}): Promise<DownloadedWorkspaceReportArtifact> {
  const artifact = reportArtifactSchema.parse(input);
  const query = reportDownloadQuerySchema.parse({ artifactId: artifact.id });
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/api/v1/workspaces/${encodeURIComponent(id)}/reports/${encodeURIComponent(reportId)}/download?${new URLSearchParams(query)}`, {
      method: 'GET', credentials: 'include', signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new WorkspaceApiError('NETWORK_ERROR', messages.NETWORK_ERROR, 0);
  }
  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = undefined; }
    const parsed = apiErrorSchema.safeParse(payload);
    if (!parsed.success) throw new WorkspaceApiError('UNEXPECTED_ERROR', messages.UNEXPECTED_ERROR, response.status);
    const rawCode = parsed.data.code === 'UNAUTHORIZED' ? 'UNAUTHENTICATED' : parsed.data.code;
    const reportCode = reportErrorCodeSchema.safeParse(rawCode);
    const code: ClientCode = reportCode.success ? reportCode.data : rawCode in messages ? rawCode as ClientCode : 'UNEXPECTED_ERROR';
    throw new WorkspaceApiError(code, messages[code], response.status, parsed.data.requestId);
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  const contentLength = response.headers.get('content-length');
  if (contentType !== artifact.contentType || (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) !== artifact.sizeBytes)) || !response.body) {
    throw new WorkspaceApiError('INVALID_RESPONSE', messages.INVALID_RESPONSE, response.status);
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(artifact.sizeBytes);
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > artifact.sizeBytes) {
      await reader.cancel();
      throw new WorkspaceApiError('INVALID_RESPONSE', messages.INVALID_RESPONSE, response.status);
    }
    bytes.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== artifact.sizeBytes) throw new WorkspaceApiError('INVALID_RESPONSE', messages.INVALID_RESPONSE, response.status);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== artifact.checksum) throw new WorkspaceApiError('INVALID_RESPONSE', messages.INVALID_RESPONSE, response.status);
  return { blob: new Blob([bytes.buffer], { type: artifact.contentType }), fileName: artifact.fileName };
}
