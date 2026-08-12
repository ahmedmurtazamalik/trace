import { createHash, randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import type { GithubAuthorizationAdapter } from '@trace/github';
import { PrismaService, type GithubAccount, type GithubInstallation } from '@trace/database';
import type { GithubCallbackQuery, GithubConnectionStatus, GithubConnectResponse } from '@trace/shared';
import { githubCallbackQuerySchema } from '@trace/shared';
import { TRACE_CONFIG } from '../../common/config/config.token';
import { GITHUB_AUTHORIZATION_ADAPTER } from './github.tokens';

const STATE_TTL_MS = 10 * 60 * 1_000;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class GithubService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRACE_CONFIG) private readonly config: TraceConfig,
    @Inject(GITHUB_AUTHORIZATION_ADAPTER) private readonly adapter: GithubAuthorizationAdapter,
  ) {}

  async connect(userId: string): Promise<GithubConnectResponse> {
    const state = randomBytes(32).toString('base64url');
    let authorizationUrl: string;
    try {
      authorizationUrl = this.adapter.authorizationUrl({ state, callbackUrl: this.callbackUrl() });
    } catch {
      throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'GitHub connection is unavailable.' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    await this.prisma.githubOauthState.create({
      data: { userId, stateTokenHash: hash(state), expiresAt: new Date(Date.now() + STATE_TTL_MS) },
    });
    return { authorizationUrl };
  }

  async callback(input: unknown, sessionUserId: string | null): Promise<string> {
    const parsed = githubCallbackQuerySchema.safeParse(input);
    if (!parsed.success) return this.redirect({ result: 'error', reason: 'callback_failed' });
    const query: GithubCallbackQuery = parsed.data;
    const state = await this.consumeState(query.state, sessionUserId);
    if (state === null) return this.redirect({ result: 'error', reason: sessionUserId === null ? 'session_expired' : 'state_invalid' });
    if ('error' in query) return this.redirect({ result: 'error', reason: 'access_denied' });
    try {
      const authorization = await this.adapter.authorize(query.code);
      const authorized = authorization.user;
      const linked = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM users WHERE id = ${state.userId} FOR UPDATE`;
        const conflict = await transaction.githubAccount.findFirst({
          where: { githubUserId: authorized.id, userId: { not: state.userId } },
        });
        if (conflict !== null) return null;
        const existingForUser = await transaction.githubAccount.findUnique({ where: { userId: state.userId } });
        if (existingForUser !== null && existingForUser.githubUserId !== authorized.id) return null;
        const wasUnlinked = existingForUser?.unlinkedAt !== null && existingForUser?.unlinkedAt !== undefined;
        const account = await transaction.githubAccount.upsert({
          where: { userId: state.userId },
          create: { userId: state.userId, githubUserId: authorized.id, githubUsername: authorized.username, displayName: authorized.displayName, avatarUrl: authorized.avatarUrl },
          update: { githubUsername: authorized.username, displayName: authorized.displayName, avatarUrl: authorized.avatarUrl, unlinkedAt: null },
        });
        const installation = authorization.installation;
        if (installation !== null) {
          const installationOwner = await transaction.githubInstallation.findUnique({
            where: { githubInstallationId: installation.id },
            select: { githubAccountId: true },
          });
          if (installationOwner !== null && installationOwner.githubAccountId !== account.id) return null;
          await transaction.githubInstallation.upsert({
            where: { githubInstallationId: installation.id },
            create: { githubInstallationId: installation.id, githubAccountId: account.id, accountType: installation.accountType, accountLogin: installation.accountLogin, suspendedAt: installation.suspended ? new Date() : null },
            update: { accountType: installation.accountType, accountLogin: installation.accountLogin, suspendedAt: installation.suspended ? new Date() : null },
          });
        }
        return { wasUnlinked };
      });
      if (linked === null) return this.redirect({ result: 'error', reason: 'callback_failed' });
      return this.redirect({ result: linked.wasUnlinked ? 'reconnect_required' : 'connected' });
    } catch {
      return this.redirect({ result: 'error', reason: 'callback_failed' });
    }
  }

  async status(userId: string): Promise<GithubConnectionStatus> {
    const account = await this.prisma.githubAccount.findUnique({ where: { userId }, include: { installations: true } });
    const activeAccount = account?.unlinkedAt === null ? account : null;
    const installation = activeAccount?.installations[0] ?? null;
    const counts = installation === null ? { accessible: 0, tracked: 0 } : await this.repositoryCounts(userId, installation.id);
    return {
      accountConnection: activeAccount === null ? { status: 'DISCONNECTED', account: null } : {
        status: 'CONNECTED', account: this.account(activeAccount),
      },
      installationAuthorization: installation === null ? { status: 'NOT_INSTALLED', installation: null } : {
        status: installation.suspendedAt === null ? 'ACTIVE' : 'SUSPENDED', installation: this.installation(installation),
      },
      accessibleRepositoryCount: counts.accessible,
      trackedRepositoryCount: counts.tracked,
      historyRetained: true,
    };
  }

  async disconnect(userId: string): Promise<void> {
    const result = await this.prisma.githubAccount.updateMany({ where: { userId, unlinkedAt: null }, data: { unlinkedAt: new Date() } });
    if (result.count === 0) throw new HttpException({ code: 'GITHUB_NOT_CONNECTED', message: 'GitHub is not connected.' }, HttpStatus.CONFLICT);
  }

  private async consumeState(state: string, sessionUserId: string | null): Promise<{ userId: string } | null> {
    if (sessionUserId === null) return null;
    return this.prisma.$transaction(async (transaction) => {
      const record = await transaction.githubOauthState.findUnique({ where: { stateTokenHash: hash(state) } });
      if (record === null || record.userId !== sessionUserId || record.consumedAt !== null || record.expiresAt <= new Date()) return null;
      const consumed = await transaction.githubOauthState.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
      return consumed.count === 1 ? { userId: record.userId } : null;
    });
  }

  private callbackUrl(): string {
    if (this.config.github.callbackUrl === undefined) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'GitHub connection is unavailable.' }, HttpStatus.SERVICE_UNAVAILABLE);
    return this.config.github.callbackUrl;
  }

  private redirect(result: { result: string; reason?: string }): string {
    const url = new URL('/settings/github', this.config.frontendOrigin);
    url.searchParams.set('result', result.result);
    if (result.reason !== undefined) url.searchParams.set('reason', result.reason);
    return url.toString();
  }

  private account(account: GithubAccount): { id: string; username: string; displayName: string | null; avatarUrl: string | null } {
    return { id: account.id, username: account.githubUsername, displayName: account.displayName, avatarUrl: account.avatarUrl };
  }

  private installation(installation: GithubInstallation): { id: string; accountType: 'USER' | 'ORGANIZATION'; accountLogin: string } {
    return { id: installation.id, accountType: installation.accountType, accountLogin: installation.accountLogin };
  }

  private async repositoryCounts(userId: string, installationId: string): Promise<{ accessible: number; tracked: number }> {
    const [accessible, tracked] = await Promise.all([
      this.prisma.repository.count({ where: { githubInstallationId: installationId } }),
      this.prisma.userRepository.count({ where: { userId, trackingEnabled: true, repository: { githubInstallationId: installationId } } }),
    ]);
    return { accessible, tracked };
  }
}
