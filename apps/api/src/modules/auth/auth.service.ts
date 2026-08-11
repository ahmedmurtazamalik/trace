import { Inject, Injectable } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import { Prisma, PrismaService, type User } from '@trace/database';
import {
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  type AuthSessionResponse,
  type ForgotPasswordResponse,
  type PublicUser,
} from '@trace/shared';
import * as argon2 from 'argon2';
import { TRACE_CONFIG } from '../../common/config/config.token';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { createOpaqueToken, deriveCsrfToken, hashCsrfToken, hashResetToken, hashSessionToken } from './auth-tokens';
import type { AuthenticatedSession } from './auth.types';
import { PASSWORD_RESET_DELIVERY, type PasswordResetDelivery } from './password-reset-delivery';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const RESET_TTL_MS = 30 * 60 * 1_000;
const RATE_WINDOW_MS = 15 * 60 * 1_000;
const ARGON_OPTIONS: argon2.Options & { type: number } = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

interface RequestContext {
  requestId?: string;
  clientAddress: string;
}

interface SessionResult {
  response: AuthSessionResponse;
  rawSessionToken: string;
}

interface SafeParseSchema<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: { flatten(): { fieldErrors: Record<string, string[] | undefined> } } };
}

@Injectable()
export class AuthService {
  private readonly dummyHash = argon2.hash('trace-invalid-credential-padding', ARGON_OPTIONS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimits: AuthRateLimitService,
    @Inject(TRACE_CONFIG) private readonly config: TraceConfig,
    @Inject(PASSWORD_RESET_DELIVERY) private readonly resetDelivery: PasswordResetDelivery,
  ) {}

  async register(input: unknown, context: RequestContext): Promise<SessionResult> {
    const parsed = this.parse(registerRequestSchema, input);
    const username = parsed.username.trim();
    const email = parsed.email?.trim().toLowerCase();
    await this.rateLimits.consume('register-ip', context.clientAddress, 5, RATE_WINDOW_MS);
    await this.assertIdentityAvailable(username, email);
    const passwordHash = await argon2.hash(parsed.password, ARGON_OPTIONS);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            username,
            displayName: parsed.displayName?.trim(),
            email,
            passwordHash,
          },
        });
        const session = await this.createSession(transaction, user);
        await transaction.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'auth.registered',
            targetType: 'user',
            targetId: user.id,
            requestId: context.requestId,
          },
        });
        return session;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.assertIdentityAvailable(username, email);
        throw this.conflict('USERNAME_TAKEN', 'That username is already registered.');
      }
      throw error;
    }
  }

  async login(input: unknown, context: RequestContext): Promise<SessionResult> {
    const parsed = this.parse(loginRequestSchema, input);
    const normalizedUsername = parsed.username.trim().toLowerCase();
    await this.rateLimits.consume('login-ip', context.clientAddress, 20, RATE_WINDOW_MS);
    await this.rateLimits.consume('login-account', normalizedUsername, 10, RATE_WINDOW_MS);

    const user = await this.prisma.user.findFirst({
      where: { username: { equals: parsed.username.trim(), mode: 'insensitive' } },
    });
    let passwordMatches = false;
    try {
      passwordMatches = await argon2.verify(user?.passwordHash ?? await this.dummyHash, parsed.password);
    } catch {
      passwordMatches = false;
    }
    if (user === null || !passwordMatches) {
      throw this.unauthorized('INVALID_CREDENTIALS', 'The supplied credentials are invalid.');
    }
    if (user.disabledAt !== null) {
      throw new HttpException(
        { code: 'ACCOUNT_DISABLED', message: 'This account is disabled.' },
        HttpStatus.FORBIDDEN,
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const session = await this.createSession(transaction, user);
      await transaction.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'auth.logged_in',
          targetType: 'session',
          targetId: user.id,
          requestId: context.requestId,
        },
      });
      return session;
    });
  }

  async authenticate(rawSessionToken: string): Promise<AuthenticatedSession | null> {
    const sessionTokenHash = hashSessionToken(rawSessionToken, this.sessionSecret());
    const record = await this.prisma.userSession.findUnique({
      where: { sessionTokenHash },
      include: { user: true },
    });
    const now = new Date();
    if (record === null || record.revokedAt !== null || record.expiresAt <= now) {
      return null;
    }
    if (record.user.disabledAt !== null) {
      await this.prisma.userSession.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: now },
      });
      return null;
    }
    if (record.lastUsedAt.getTime() < now.getTime() - 5 * 60 * 1_000) {
      await this.prisma.userSession.update({ where: { id: record.id }, data: { lastUsedAt: now } });
    }
    return { user: record.user, session: record, rawSessionToken };
  }

  sessionResponse(auth: AuthenticatedSession): AuthSessionResponse {
    return {
      user: this.publicUser(auth.user),
      csrfToken: deriveCsrfToken(auth.rawSessionToken, this.sessionSecret()),
    };
  }

  async logout(auth: AuthenticatedSession, requestId?: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({
        where: { id: auth.session.id, userId: auth.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: auth.user.id,
          action: 'auth.logged_out',
          targetType: 'session',
          targetId: auth.session.id,
          requestId,
        },
      }),
    ]);
  }

  async forgotPassword(input: unknown, context: RequestContext): Promise<ForgotPasswordResponse> {
    const parsed = this.parse(forgotPasswordRequestSchema, input);
    const identifier = parsed.identifier.trim().toLowerCase();
    await this.rateLimits.consume('forgot-ip', context.clientAddress, 10, RATE_WINDOW_MS);
    await this.rateLimits.consume('forgot-identifier', identifier, 5, RATE_WINDOW_MS);

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: identifier, mode: 'insensitive' } },
          { email: { equals: identifier, mode: 'insensitive' } },
        ],
      },
    });
    if (user !== null && user.disabledAt === null && user.email !== null) {
      const rawToken = createOpaqueToken();
      const expiresAt = new Date(Date.now() + RESET_TTL_MS);
      await this.prisma.$transaction(async (transaction) => {
        await transaction.passwordResetToken.deleteMany({ where: { userId: user.id, consumedAt: null } });
        await transaction.passwordResetToken.create({
          data: { userId: user.id, tokenHash: hashResetToken(rawToken), expiresAt },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'auth.password_reset_requested',
            targetType: 'user',
            targetId: user.id,
            requestId: context.requestId,
          },
        });
      });
      try {
        await this.resetDelivery.deliver({ email: user.email, token: rawToken, expiresAt });
      } catch {
        // The public response remains deliberately non-enumerating.
      }
    }
    return forgotPasswordResponseSchema.parse({
      message: 'If the account exists, password reset instructions have been sent.',
    });
  }

  async resetPassword(input: unknown, context: RequestContext): Promise<void> {
    const parsed = this.parse(resetPasswordRequestSchema, input);
    await this.rateLimits.consume('reset-ip', context.clientAddress, 10, RATE_WINDOW_MS);
    await this.rateLimits.consume('reset-token', hashResetToken(parsed.token), 5, RATE_WINDOW_MS);
    const passwordHash = await argon2.hash(parsed.password, ARGON_OPTIONS);
    const tokenHash = hashResetToken(parsed.token);
    const now = new Date();

    try {
      await this.prisma.$transaction(async (transaction) => {
        const token = await transaction.passwordResetToken.findUnique({ where: { tokenHash } });
        if (token === null || token.consumedAt !== null || token.expiresAt <= now) {
          throw this.invalidResetToken();
        }
        const consumed = await transaction.passwordResetToken.updateMany({
          where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now },
        });
        if (consumed.count !== 1) {
          throw this.invalidResetToken();
        }
        await transaction.user.update({ where: { id: token.userId }, data: { passwordHash } });
        await transaction.userSession.updateMany({
          where: { userId: token.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await transaction.passwordResetToken.updateMany({
          where: { userId: token.userId, consumedAt: null },
          data: { consumedAt: now },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: token.userId,
            action: 'auth.password_reset_completed',
            targetType: 'user',
            targetId: token.userId,
            requestId: context.requestId,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw this.invalidResetToken();
      }
      throw error;
    }
  }

  private async createSession(transaction: Prisma.TransactionClient, user: User): Promise<SessionResult> {
    const rawSessionToken = createOpaqueToken();
    const csrfToken = deriveCsrfToken(rawSessionToken, this.sessionSecret());
    await transaction.userSession.create({
      data: {
        userId: user.id,
        sessionTokenHash: hashSessionToken(rawSessionToken, this.sessionSecret()),
        csrfTokenHash: hashCsrfToken(csrfToken),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return {
      rawSessionToken,
      response: { user: this.publicUser(user), csrfToken },
    };
  }

  private async assertIdentityAvailable(username: string, email?: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: username, mode: 'insensitive' } },
          ...(email === undefined ? [] : [{ email: { equals: email, mode: 'insensitive' as const } }]),
        ],
      },
      select: { username: true, email: true },
    });
    if (existing?.username.toLowerCase() === username.toLowerCase()) {
      throw this.conflict('USERNAME_TAKEN', 'That username is already registered.');
    }
    if (email !== undefined && existing?.email?.toLowerCase() === email) {
      throw this.conflict('EMAIL_TAKEN', 'That email is already registered.');
    }
  }

  private parse<T>(schema: SafeParseSchema<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new HttpException(
        {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          fieldErrors: result.error.flatten().fieldErrors,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    return result.data;
  }

  private publicUser(user: User): PublicUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private sessionSecret(): string {
    if (this.config.sessionSecret === undefined) {
      throw new HttpException(
        { code: 'SERVICE_UNAVAILABLE', message: 'Authentication is temporarily unavailable.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.config.sessionSecret;
  }

  private conflict(code: string, message: string): HttpException {
    return new HttpException({ code, message }, HttpStatus.CONFLICT);
  }

  private unauthorized(code: string, message: string): HttpException {
    return new HttpException({ code, message }, HttpStatus.UNAUTHORIZED);
  }

  private invalidResetToken(): HttpException {
    return new HttpException(
      { code: 'INVALID_OR_EXPIRED_RESET_TOKEN', message: 'The reset token is invalid or expired.' },
      HttpStatus.BAD_REQUEST,
    );
  }
}
