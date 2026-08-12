import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import type { AuthSessionResponse, ForgotPasswordResponse, LogoutResponse, ResetPasswordResponse } from '@trace/shared';
import type { CookieOptions, Request, Response } from 'express';
import { TRACE_CONFIG } from '../../common/config/config.token';
import type { RequestWithId } from '../../common/middleware/request-id.middleware';
import { AuthService } from './auth.service';
import { CurrentSession } from './current-session.decorator';
import { CsrfGuard } from './csrf.guard';
import { sessionCookieName, type AuthenticatedSession } from './auth.types';
import { SessionAuthGuard } from './session-auth.guard';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(TRACE_CONFIG) private readonly config: TraceConfig,
  ) {}

  @Post('register')
  async register(
    @Body() body: unknown,
    @Req() request: Request & RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const result = await this.authService.register(body, this.context(request));
    this.setSessionCookie(response, result.rawSessionToken);
    return result.response;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() request: Request & RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const result = await this.authService.login(body, this.context(request));
    this.setSessionCookie(response, result.rawSessionToken);
    return result.response;
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@CurrentSession() auth: AuthenticatedSession): AuthSessionResponse {
    return this.authService.sessionResponse(auth);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  async logout(
    @CurrentSession() auth: AuthenticatedSession,
    @Req() request: Request & RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LogoutResponse> {
    await this.authService.logout(auth, request.requestId);
    response.cookie(sessionCookieName, '', {
      ...this.cookieOptions(),
      expires: new Date(0),
      maxAge: 0,
    });
    return { success: true };
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(
    @Body() body: unknown,
    @Req() request: Request & RequestWithId,
  ): Promise<ForgotPasswordResponse> {
    return this.authService.forgotPassword(body, this.context(request));
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() body: unknown,
    @Req() request: Request & RequestWithId,
  ): Promise<ResetPasswordResponse> {
    await this.authService.resetPassword(body, this.context(request));
    return { success: true };
  }

  private context(request: Request & RequestWithId): { requestId?: string; clientAddress: string } {
    return {
      requestId: request.requestId,
      clientAddress: request.socket.remoteAddress ?? 'unknown',
    };
  }

  private setSessionCookie(response: Response, token: string): void {
    response.cookie(sessionCookieName, token, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/api/v1',
      maxAge: SESSION_TTL_MS,
    };
  }
}
