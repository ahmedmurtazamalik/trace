import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { ReportCreateResponse, ReportDetailResponse, ReportListResponse } from '@trace/shared';
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

  @Get(':id')
  detail(@CurrentSession() session: AuthenticatedSession, @Param('id') reportId: string): Promise<ReportDetailResponse> {
    return this.reports.detail(session.user.id, reportId);
  }
}
