import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { ActivityListResponse } from '@trace/shared';
import { CurrentSession } from '../auth/current-session.decorator';
import type { AuthenticatedSession } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ActivityService } from './activity.service';

@Controller()
@UseGuards(SessionAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('activity')
  list(@CurrentSession() session: AuthenticatedSession, @Query() query: unknown): Promise<ActivityListResponse> {
    return this.activity.list(session.user.id, query);
  }

  @Get('repositories/:id/activity')
  repository(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id') repositoryId: string,
    @Query() query: unknown,
  ): Promise<ActivityListResponse> {
    return this.activity.list(session.user.id, query, repositoryId);
  }
}
