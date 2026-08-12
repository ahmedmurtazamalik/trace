import { Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { RepositoryDetailResponse, RepositoryListResponse, RepositoryTrackingResponse } from '@trace/shared';
import { CurrentSession } from '../auth/current-session.decorator';
import { CsrfGuard } from '../auth/csrf.guard';
import type { AuthenticatedSession } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RepositoriesService } from './repositories.service';

@Controller('repositories')
@UseGuards(SessionAuthGuard)
export class RepositoriesController {
  constructor(private readonly repositories: RepositoriesService) {}

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

  @Post('sync')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  synchronize(@CurrentSession() session: AuthenticatedSession): Promise<{ accessibleRepositoryCount: number }> {
    return this.repositories.synchronize(session.user.id);
  }
}
