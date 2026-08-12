import { Controller, Delete, Get, Query, Redirect, Req, UseGuards } from '@nestjs/common';
import type { GithubConnectionStatus, GithubConnectResponse, GithubDisconnectResponse } from '@trace/shared';
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

  @Get('connect')
  @UseGuards(SessionAuthGuard)
  connect(@CurrentSession() session: AuthenticatedSession): Promise<GithubConnectResponse> {
    return this.github.connect(session.user.id);
  }

  @Get('callback')
  @Redirect()
  async callback(@Query() query: unknown, @Req() request: Request): Promise<{ url: string; statusCode: number }> {
    const rawToken = readSessionCookie(request);
    const session = rawToken === undefined ? null : await this.auth.authenticate(rawToken);
    return { url: await this.github.callback(query, session?.user.id ?? null), statusCode: 302 };
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
}
