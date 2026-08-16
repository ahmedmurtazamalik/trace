import { Controller, Delete, Get, HttpCode, Post, Query, Redirect, Req, UseGuards } from '@nestjs/common';
import type {
  GithubConnectionStatus,
  GithubConnectResponse,
  GithubDisconnectResponse,
  GithubInstallationStartResponse,
} from '@trace/shared';
import type { Request } from 'express';
import { CurrentSession } from '../auth/current-session.decorator';
import { CsrfGuard } from '../auth/csrf.guard';
import type { AuthenticatedSession } from '../auth/auth.types';
import { readSessionCookie } from '../auth/auth.types';
import { AuthService } from '../auth/auth.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GithubService } from './github.service';

@Controller('github')
export class GithubController {
  constructor(private readonly github: GithubService, private readonly auth: AuthService) {}

  @Post('connect')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  connect(@CurrentSession() session: AuthenticatedSession, @Req() request: Request): Promise<GithubConnectResponse> {
    return this.github.connect(session.user.id, session.session.id, this.directAddress(request));
  }

  @Get('callback')
  @Redirect()
  async callback(@Query() query: unknown, @Req() request: Request): Promise<{ url: string; statusCode: number }> {
    const session = await this.optionalSession(request);
    return {
      url: await this.github.callback(query, session === null ? null : { userId: session.user.id, sessionId: session.session.id }),
      statusCode: 302,
    };
  }

  @Post('installation')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  startInstallation(@CurrentSession() session: AuthenticatedSession, @Req() request: Request): Promise<GithubInstallationStartResponse> {
    return this.github.startInstallation(session.user.id, session.session.id, this.directAddress(request));
  }

  @Get('installation/callback')
  @Redirect()
  async installationCallback(@Query() query: unknown, @Req() request: Request): Promise<{ url: string; statusCode: number }> {
    const session = await this.optionalSession(request);
    return {
      url: await this.github.installationCallback(query, session === null ? null : { userId: session.user.id, sessionId: session.session.id }),
      statusCode: 302,
    };
  }

  @Get('status')
  @UseGuards(SessionAuthGuard)
  status(@CurrentSession() session: AuthenticatedSession): Promise<GithubConnectionStatus> {
    return this.github.status(session.user.id);
  }

  @Delete('connection')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  async disconnect(@CurrentSession() session: AuthenticatedSession): Promise<GithubDisconnectResponse> {
    await this.github.disconnect(session.user.id);
    return { success: true, historyRetained: true };
  }

  private async optionalSession(request: Request): Promise<AuthenticatedSession | null> {
    const rawToken = readSessionCookie(request);
    return rawToken === undefined ? null : this.auth.authenticate(rawToken);
  }

  private directAddress(request: Request): string {
    return request.socket.remoteAddress ?? 'unknown';
  }
}
