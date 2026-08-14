import { Body, Controller, Get, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { ReportCreateResponse, ReportDetailResponse, ReportListResponse } from '@trace/shared';
import type { Response } from 'express';
import { CurrentSession } from '../auth/current-session.decorator';
import { CsrfGuard } from '../auth/csrf.guard';
import type { AuthenticatedSession } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(SessionAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @UseGuards(CsrfGuard)
  create(@CurrentSession() session: AuthenticatedSession, @Body() body: unknown): Promise<ReportCreateResponse> {
    return this.reports.create(session.user.id, body);
  }

  @Get()
  list(@CurrentSession() session: AuthenticatedSession, @Query() query: unknown): Promise<ReportListResponse> {
    return this.reports.list(session.user.id, query);
  }

  @Put(':id/revision')
  @UseGuards(CsrfGuard)
  updateRevision(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') reportId: string,
    @Body() body: unknown,
  ): Promise<ReportDetailResponse> {
    return this.reports.updateRevision(session.user.id, reportId, body);
  }

  @Post(':id/regenerate')
  @UseGuards(CsrfGuard)
  regenerate(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') reportId: string,
    @Body() body: unknown,
  ): Promise<ReportDetailResponse> {
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
}
