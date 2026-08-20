import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type {
  WorkspaceArchiveResponse,
  WorkspaceCreateResponse,
  WorkspaceDetailResponse,
  WorkspaceListResponse,
  WorkspaceInvitationCreateResponse,
  WorkspaceInvitationDecisionResponse,
  WorkspaceInvitationListResponse,
  WorkspaceMemberRemovalResponse,
  WorkspaceMembershipResponse,
  WorkspaceRepositoryAssignmentResponse,
  WorkspaceRepositoryRemovalResponse,
  WorkspaceUpdateResponse,
  WorkspaceAnalysisResponse,
  WorkspaceAnalysisStartResponse,
  WorkspaceReportGenerateResponse,
  WorkspaceReportOccurrenceListResponse,
  WorkspaceReportScheduleResponse,
  WorkspaceReportDetailResponse,
  ReportDetailResponse,
  ReportListResponse,

} from '@trace/shared';
import type { Request, Response } from 'express';
import { CurrentSession } from '../auth/current-session.decorator';
import { CsrfGuard } from '../auth/csrf.guard';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import type { AuthenticatedSession } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { WorkspacesService } from './workspaces.service';
import { WorkspaceAnalysisService } from './workspace-analysis.service';
import { WorkspaceReportsService } from './workspace-reports.service';
import { WorkspaceInvitationsService } from './workspace-invitations.service';


@Controller('workspaces')
@UseGuards(SessionAuthGuard)
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly analysis: WorkspaceAnalysisService,
    private readonly reports: WorkspaceReportsService,

    private readonly rateLimits: AuthRateLimitService,
    private readonly invitations: WorkspaceInvitationsService,
  ) {}

  @Post()
  @UseGuards(CsrfGuard)
  create(@CurrentSession() session: AuthenticatedSession, @Body() body: unknown): Promise<WorkspaceCreateResponse> {
    return this.workspaces.create(session.user.id, body);
  }

  @Get()
  list(@CurrentSession() session: AuthenticatedSession): Promise<WorkspaceListResponse> {
    return this.workspaces.list(session.user.id);
  }

  @Get(':id')
  detail(@CurrentSession() session: AuthenticatedSession, @Param('id') id: string): Promise<WorkspaceDetailResponse> {
    return this.workspaces.detail(session.user.id, id);
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  update(@CurrentSession() session: AuthenticatedSession, @Param('id') id: string, @Body() body: unknown): Promise<WorkspaceUpdateResponse> {
    return this.workspaces.update(session.user.id, id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  archive(@CurrentSession() session: AuthenticatedSession, @Param('id') id: string): Promise<WorkspaceArchiveResponse> {
    return this.workspaces.archive(session.user.id, id);
  }

  @Post(':id/invitations')
  @UseGuards(CsrfGuard)
  async createInvitation(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<WorkspaceInvitationCreateResponse> {
    await this.consumePaidWork('workspace-invitation-create', session.user.id, request, 30, 150, 1_500);
    return this.invitations.create(session.user.id, id, body);
  }

  @Get(':id/invitations')
  listInvitations(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
  ): Promise<WorkspaceInvitationListResponse> {
    return this.invitations.listWorkspace(session.user.id, id);
  }

  @Post(':id/invitations/:invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  revokeInvitation(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
  ): Promise<WorkspaceInvitationDecisionResponse> {
    return this.invitations.revoke(session.user.id, id, invitationId);
  }

  @Patch(':id/members/:userId')
  @UseGuards(CsrfGuard)
  updateMemberRole(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<WorkspaceMembershipResponse> {
    return this.workspaces.updateMemberRole(session.user.id, id, userId, body);
  }

  @Delete(':id/members/:userId')
  @UseGuards(CsrfGuard)
  removeMember(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<WorkspaceMemberRemovalResponse> {
    return this.workspaces.removeMember(session.user.id, id, userId);
  }

  @Post(':id/repositories')
  @UseGuards(CsrfGuard)
  async assignRepository(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WorkspaceRepositoryAssignmentResponse> {
    const result = await this.workspaces.assignRepository(session.user.id, id, body);
    response.status(result.created ? 201 : 200);
    return result.response;
  }

  @Delete(':id/repositories/:repositoryId')
  @UseGuards(CsrfGuard)
  removeRepository(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Param('repositoryId') repositoryId: string,
  ): Promise<WorkspaceRepositoryRemovalResponse> {
    return this.workspaces.removeRepository(session.user.id, id, repositoryId);
  }

  @Post(':id/reports/generate')
  @UseGuards(CsrfGuard)
  async generateReport(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ): Promise<WorkspaceReportGenerateResponse> {
    await this.consumePaidWork('workspace-report-create', session.user.id, request, 20, 100, 1_000);
    const rawKey = headers['idempotency-key'];
    const idempotencyKey = Array.isArray(rawKey) ? undefined : rawKey;
    const result = await this.reports.generate(session.user.id, id, idempotencyKey, body);
    response.status(result.created ? 201 : 200);
    return result.response;
  }

  @Get(':id/reports')
  listReports(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<ReportListResponse> {
    return this.reports.list(session.user.id, id, query);
  }

  @Put(':id/reports/:reportId/revision')
  @UseGuards(CsrfGuard)
  updateReportRevision(
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<ReportDetailResponse> {
    return this.updateReportRevisionLimited(session, request, id, reportId, body);
  }

  private async updateReportRevisionLimited(
    session: AuthenticatedSession,
    request: Request,
    id: string,
    reportId: string,
    body: unknown,
  ): Promise<ReportDetailResponse> {
    await this.consumePaidWork('workspace-report-revision', session.user.id, request, 60, 300, 3_000);
    return this.reports.updateRevision(session.user.id, id, reportId, body);
  }

  @Post(':id/reports/:reportId/regenerate')
  @UseGuards(CsrfGuard)
  async regenerateReport(
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<ReportDetailResponse> {
    await this.consumePaidWork('workspace-report-regenerate', session.user.id, request, 20, 100, 1_000);
    return this.reports.regenerate(session.user.id, id, reportId, body);
  }


  @Get(':id/reports/:reportId/download')
  async downloadReport(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
    @Query() query: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const artifact = await this.reports.download(session.user.id, id, reportId, query);
    response.status(200);
    response.setHeader('Content-Type', artifact.contentType);
    response.setHeader('Content-Length', artifact.bytes.length.toString());
    response.setHeader('Content-Disposition', `attachment; filename="${artifact.fileName}"`);
    response.setHeader('ETag', `"sha256-${artifact.checksum}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.end(artifact.bytes);
  }

  @Get(':id/reports/:reportId')
  reportDetail(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
  ): Promise<WorkspaceReportDetailResponse> {
    return this.reports.detail(session.user.id, id, reportId);
  }

  @Get(':id/report-schedule')
  getReportSchedule(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
  ): Promise<WorkspaceReportScheduleResponse> {
    return this.reports.getSchedule(session.user.id, id);
  }

  @Put(':id/report-schedule')
  @UseGuards(CsrfGuard)
  putReportSchedule(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WorkspaceReportScheduleResponse> {
    return this.reports.putSchedule(session.user.id, id, body);
  }

  @Delete(':id/report-schedule')
  @UseGuards(CsrfGuard)
  disableReportSchedule(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
  ): Promise<WorkspaceReportScheduleResponse> {
    return this.reports.disableSchedule(session.user.id, id);
  }

  @Get(':id/report-occurrences')
  listReportOccurrences(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
  ): Promise<WorkspaceReportOccurrenceListResponse> {
    return this.reports.listOccurrences(session.user.id, id);
  }

  @Get(':id/analysis')
  listAnalysis(@CurrentSession() session: AuthenticatedSession, @Param('id') id: string): Promise<WorkspaceAnalysisResponse> {
    return this.analysis.list(session.user.id, id);
  }

  @Post(':id/repositories/:repositoryId/baseline')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async startAnalysis(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') id: string,
    @Param('repositoryId') repositoryId: string,
    @Req() request: Request,
  ): Promise<WorkspaceAnalysisStartResponse> {
    await this.consumePaidWork('workspace-baseline', session.user.id, request, 10, 50, 500);
    return this.analysis.start(session.user.id, id, repositoryId);
  }

  private async consumePaidWork(
    operation: string,
    userId: string,
    request: Request,
    userLimit: number,
    addressLimit: number,
    deploymentLimit: number,
  ): Promise<void> {
    await this.rateLimits.consume(operation, userId, userLimit, 3_600_000);
    await this.rateLimits.consume(`${operation}:address`, request.socket.remoteAddress ?? 'unknown', addressLimit, 3_600_000);
    await this.rateLimits.consume(`${operation}:deployment`, 'all', deploymentLimit, 3_600_000);
  }
}
