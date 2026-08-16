import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { ReportCreateResponse, ReportDetailResponse, ReportListResponse } from '@trace/shared';
import type { Request, Response } from 'express';
import { CurrentSession } from '../auth/current-session.decorator';
import { CsrfGuard } from '../auth/csrf.guard';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import type { AuthenticatedSession } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(SessionAuthGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly rateLimits: AuthRateLimitService,
  ) {}

  @Post()
  @UseGuards(CsrfGuard)
  async create(@CurrentSession() session: AuthenticatedSession, @Req() request: Request, @Body() body: unknown): Promise<ReportCreateResponse> {
    await this.consumePaidWork('report-create', session.user.id, request, 20, 100, 1_000);
    return this.reports.create(session.user.id, body);
  }

  @Get()
  list(@CurrentSession() session: AuthenticatedSession, @Query() query: unknown): Promise<ReportListResponse> {
    return this.reports.list(session.user.id, query);
  }

  @Put(':id/revision')
  @UseGuards(CsrfGuard)
  async updateRevision(
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
    @Param('id') reportId: string,
    @Body() body: unknown,
  ): Promise<ReportDetailResponse> {
    await this.consumePaidWork('report-revision', session.user.id, request, 60, 300, 3_000);
    return this.reports.updateRevision(session.user.id, reportId, body);
  }

  @Post(':id/regenerate')
  @UseGuards(CsrfGuard)
  async regenerate(
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
    @Param('id') reportId: string,
    @Body() body: unknown,
  ): Promise<ReportDetailResponse> {
    await this.consumePaidWork('report-regenerate', session.user.id, request, 20, 100, 1_000);
    return this.reports.regenerate(session.user.id, reportId, body);
  }

  @Get(':id/download')
  async download(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') reportId: string,
    @Query() query: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const artifact = await this.reports.download(session.user.id, reportId, query);
    response.status(200);
    response.setHeader('Content-Type', artifact.contentType);
    response.setHeader('Content-Length', artifact.bytes.length.toString());
    response.setHeader('Content-Disposition', `attachment; filename="${artifact.fileName}"`);
    response.setHeader('ETag', `"sha256-${artifact.checksum}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.end(artifact.bytes);
  }

  @Get(':id')
  detail(@CurrentSession() session: AuthenticatedSession, @Param('id') reportId: string): Promise<ReportDetailResponse> {
    return this.reports.detail(session.user.id, reportId);
  }

  private async consumePaidWork(operation: string, userId: string, request: Request, userLimit: number, addressLimit: number, deploymentLimit: number): Promise<void> {
    await this.rateLimits.consume(operation, userId, userLimit, 3_600_000);
    await this.rateLimits.consume(`${operation}:address`, request.socket.remoteAddress ?? 'unknown', addressLimit, 3_600_000);
    await this.rateLimits.consume(`${operation}:deployment`, 'all', deploymentLimit, 3_600_000);
  }
}
