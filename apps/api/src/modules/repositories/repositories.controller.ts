import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { RepositoryDetailResponse, RepositoryForgottenResponse, RepositoryListResponse, RepositoryMembershipResponse, RepositorySynchronizationResponse, RepositoryTrackingResponse } from '@trace/shared';
import type { Request } from 'express';
import { CurrentSession } from '../auth/current-session.decorator';
import { CsrfGuard } from '../auth/csrf.guard';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import type { AuthenticatedSession } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RepositoriesService } from './repositories.service';

@Controller('repositories')
@UseGuards(SessionAuthGuard)
export class RepositoriesController {
  constructor(
    private readonly repositories: RepositoriesService,
    private readonly rateLimits: AuthRateLimitService,
  ) {}

  @Get()
  list(@CurrentSession() session: AuthenticatedSession, @Query() query: unknown): Promise<RepositoryListResponse> {
    return this.repositories.list(session.user.id, query);
  }

  @Get(':id')
  detail(@CurrentSession() session: AuthenticatedSession, @Param('id') id: string): Promise<RepositoryDetailResponse> {
    return this.repositories.detail(session.user.id, id);
  }

  @Post(':id/tracking')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  enableTracking(@CurrentSession() session: AuthenticatedSession, @Param('id') id: string): Promise<RepositoryTrackingResponse> {
    return this.repositories.setTracking(session.user.id, id, true);
  }

  @Delete(':id/tracking')
  @UseGuards(CsrfGuard)
  disableTracking(@CurrentSession() session: AuthenticatedSession, @Param('id') id: string): Promise<RepositoryTrackingResponse> {
    return this.repositories.setTracking(session.user.id, id, false);
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  remove(@CurrentSession() session: AuthenticatedSession, @Param('id') id: string): Promise<RepositoryMembershipResponse> {
    return this.repositories.setRemoved(session.user.id, id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  restore(@CurrentSession() session: AuthenticatedSession, @Param('id') id: string): Promise<RepositoryMembershipResponse> {
    return this.repositories.setRemoved(session.user.id, id, false);
  }

  @Delete(':id/forget')
  @UseGuards(CsrfGuard)
  forget(@CurrentSession() session: AuthenticatedSession, @Param('id') id: string): Promise<RepositoryForgottenResponse> {
    return this.repositories.forget(session.user.id, id);
  }

  @Post('sync')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async synchronize(@CurrentSession() session: AuthenticatedSession, @Req() request: Request): Promise<RepositorySynchronizationResponse> {
    await this.rateLimits.consume('repository-sync', session.user.id, 30, 3_600_000);
    await this.rateLimits.consume('repository-sync:address', request.socket.remoteAddress ?? 'unknown', 150, 3_600_000);
    await this.rateLimits.consume('repository-sync:deployment', 'all', 1_500, 3_600_000);
    return this.repositories.synchronize(session.user.id);
  }
}
