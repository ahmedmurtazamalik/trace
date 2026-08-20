import { Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import type {
  WorkspaceInvitationAcceptResponse,
  WorkspaceInvitationDecisionResponse,
  WorkspaceInvitationDetailResponse,
  WorkspaceInvitationListResponse,
} from '@trace/shared';
import { CurrentSession } from '../auth/current-session.decorator';
import { CsrfGuard } from '../auth/csrf.guard';
import type { AuthenticatedSession } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { WorkspaceInvitationsService } from './workspace-invitations.service';

@Controller('workspace-invitations')
@UseGuards(SessionAuthGuard)
export class WorkspaceInvitationsController {
  constructor(private readonly invitations: WorkspaceInvitationsService) {}

  @Get()
  listMine(@CurrentSession() session: AuthenticatedSession): Promise<WorkspaceInvitationListResponse> {
    return this.invitations.listMine(session.user.id);
  }

  @Get(':invitationId')
  detail(
    @CurrentSession() session: AuthenticatedSession,
    @Param('invitationId') invitationId: string,
    @Headers('x-workspace-invitation-token') token?: string,
  ): Promise<WorkspaceInvitationDetailResponse> {
    return this.invitations.detail(session.user.id, invitationId, token);
  }

  @Post(':invitationId/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  accept(
    @CurrentSession() session: AuthenticatedSession,
    @Param('invitationId') invitationId: string,
    @Headers('x-workspace-invitation-token') token?: string,
  ): Promise<WorkspaceInvitationAcceptResponse> {
    return this.invitations.accept(session.user.id, invitationId, token);
  }

  @Post(':invitationId/decline')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  decline(
    @CurrentSession() session: AuthenticatedSession,
    @Param('invitationId') invitationId: string,
    @Headers('x-workspace-invitation-token') token?: string,
  ): Promise<WorkspaceInvitationDecisionResponse> {
    return this.invitations.decline(session.user.id, invitationId, token);
  }
}
