import { createHash, randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';
import type { GithubAuthorizationAdapter, GithubInstallationAccess } from '@trace/github';
import { PrismaService, type GithubAccount, type GithubInstallation } from '@trace/database';
import type {
  GithubCallbackQuery,
  GithubConnectionStatus,
  GithubConnectResponse,
  GithubInstallationCallbackQuery,
  GithubInstallationStartResponse,
} from '@trace/shared';
import { githubCallbackQuerySchema, githubInstallationCallbackQuerySchema } from '@trace/shared';
import { TRACE_CONFIG } from '../../common/config/config.token';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { GITHUB_AUTHORIZATION_ADAPTER } from './github.tokens';

const STATE_TTL_MS = 10 * 60 * 1_000;
const LINK_LIMIT = 10;
const LINK_WINDOW_MS = 15 * 60 * 1_000;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
type StatePurpose = 'OAUTH' | 'INSTALLATION' | 'INSTALLATION_VERIFY';

@Injectable()
export class GithubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: AuthRateLimitService,
    @Inject(TRACE_CONFIG) private readonly config: TraceConfig,
    @Inject(GITHUB_AUTHORIZATION_ADAPTER) private readonly adapter: GithubAuthorizationAdapter,
  ) {}

  async connect(userId: string, sessionId: string, directAddress: string): Promise<GithubConnectResponse> {
    await this.limit('connect', userId, directAddress);
    const state = randomBytes(32).toString('base64url');
    let authorizationUrl: string;
    try {
      authorizationUrl = this.adapter.authorizationUrl({ state, callbackUrl: this.callbackUrl() });
    } catch {
      throw this.unavailable();
    }
    await this.storeState(userId, sessionId, state, 'OAUTH');
    return { authorizationUrl };
  }

  async callback(input: unknown, session: { userId: string; sessionId: string } | null): Promise<string> {
    const parsed = githubCallbackQuerySchema.safeParse(input);
    if (!parsed.success) return this.redirect({ result: 'error', reason: 'callback_failed' });
    const query: GithubCallbackQuery = parsed.data;
    const state = await this.consumeState(query.state, session, ['OAUTH', 'INSTALLATION_VERIFY']);
    if (state === null) return this.redirect({ result: 'error', reason: session === null ? 'session_expired' : 'state_invalid' });
    if ('error' in query) return this.redirect({ result: 'error', reason: 'access_denied' });
    try {
      if (state.purpose === 'INSTALLATION_VERIFY') {
        if (state.installationId === null) return this.redirect({ result: 'error', reason: 'callback_failed' });
        const verified = await this.adapter.verifyInstallation(query.code, state.installationId);
        const account = await this.prisma.githubAccount.findUnique({ where: { userId: state.userId } });
        if (account === null || account.unlinkedAt !== null || account.githubUserId !== verified.user.id) {
          return this.redirect({ result: 'error', reason: 'callback_failed' });
        }
        const persisted = await this.persistInstallation(state.userId, verified.installation);
        return this.redirect(persisted ? { result: 'connected' } : { result: 'error', reason: 'callback_failed' });
      }
      const authorized = (await this.adapter.authorize(query.code)).user;
      const linked = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM users WHERE id = ${state.userId} FOR UPDATE`;
        const conflict = await transaction.githubAccount.findFirst({ where: { githubUserId: authorized.id, userId: { not: state.userId } } });
        if (conflict !== null) return false;
        const existing = await transaction.githubAccount.findUnique({ where: { userId: state.userId } });
        if (existing !== null && existing.githubUserId !== authorized.id) return false;
        const linkedAccount = await transaction.githubAccount.upsert({
          where: { userId: state.userId },
          create: { userId: state.userId, githubUserId: authorized.id, githubUsername: authorized.username, displayName: authorized.displayName, avatarUrl: authorized.avatarUrl },
          update: { githubUsername: authorized.username, displayName: authorized.displayName, avatarUrl: authorized.avatarUrl, unlinkedAt: null },
        });
        await transaction.auditLog.create({
          data: { actorUserId: state.userId, action: 'github.connected', targetType: 'github_account', targetId: linkedAccount.id },
        });
        return true;
      });
      return this.redirect(linked ? { result: 'connected' } : { result: 'error', reason: 'callback_failed' });
    } catch {
      return this.redirect({ result: 'error', reason: 'callback_failed' });
    }
  }

  async startInstallation(userId: string, sessionId: string, directAddress: string): Promise<GithubInstallationStartResponse> {
    await this.limit('installation', userId, directAddress);
    const account = await this.prisma.githubAccount.findUnique({ where: { userId } });
    if (account === null || account.unlinkedAt !== null) {
      throw new HttpException({ code: 'GITHUB_RECONNECT_REQUIRED', message: 'Reconnect GitHub before installing the App.' }, HttpStatus.CONFLICT);
    }
    const state = randomBytes(32).toString('base64url');
    let installationUrl: string;
    try {
      installationUrl = this.adapter.installationUrl({ state, appSlug: this.appSlug() });
    } catch {
      throw this.unavailable();
    }
    await this.storeState(userId, sessionId, state, 'INSTALLATION');
    return { installationUrl };
  }

  async installationCallback(input: unknown, session: { userId: string; sessionId: string } | null): Promise<string> {
    const parsed = githubInstallationCallbackQuerySchema.safeParse(input);
    if (!parsed.success) return this.redirect({ result: 'error', reason: 'callback_failed' });
    const query: GithubInstallationCallbackQuery = parsed.data;
    const state = await this.consumeState(query.state, session, 'INSTALLATION');
    if (state === null) return this.redirect({ result: 'error', reason: session === null ? 'session_expired' : 'state_invalid' });
    try {
      const installationId = BigInt(query.installation_id);
      await this.adapter.installation(installationId);
      const verificationState = randomBytes(32).toString('base64url');
      await this.storeState(state.userId, state.sessionId, verificationState, 'INSTALLATION_VERIFY', installationId.toString());
      return this.adapter.authorizationUrl({ state: verificationState, callbackUrl: this.callbackUrl() });
    } catch {
      return this.redirect({ result: 'error', reason: 'callback_failed' });
    }
  }

  async status(userId: string): Promise<GithubConnectionStatus> {
    const account = await this.prisma.githubAccount.findUnique({ where: { userId }, include: { installations: true } });
    const active = account?.unlinkedAt === null ? account : null;
    const orderedInstallations = [...(active?.installations ?? [])].sort((left, right) => left.id.localeCompare(right.id));
    const activeInstallations = orderedInstallations.filter((candidate) => candidate.suspendedAt === null);
    const installation = activeInstallations[0] ?? orderedInstallations[0] ?? null;
    const counts = activeInstallations.length === 0 ? { accessible: 0, tracked: 0 } : await this.repositoryCounts(userId, activeInstallations.map((candidate) => candidate.id));
    const accountConnection = account === null
      ? { status: 'DISCONNECTED' as const, account: null }
      : account.unlinkedAt === null
        ? { status: 'CONNECTED' as const, account: this.account(account) }
        : { status: 'RECONNECT_REQUIRED' as const, account: this.account(account) };
    return {
      accountConnection,
      installationAuthorization: installation === null ? { status: 'NOT_INSTALLED', installation: null } : {
        status: installation.suspendedAt === null ? 'ACTIVE' : 'SUSPENDED', installation: this.installationDto(installation),
      },
      accessibleRepositoryCount: counts.accessible,
      trackedRepositoryCount: counts.tracked,
      historyRetained: true,
    };
  }

  async disconnect(userId: string): Promise<void> {
    const disconnected = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const result = await transaction.githubAccount.updateMany({ where: { userId, unlinkedAt: null }, data: { unlinkedAt: new Date() } });
      if (result.count === 1) {
        const account = await transaction.githubAccount.findUniqueOrThrow({ where: { userId }, select: { id: true } });
        await transaction.auditLog.create({
          data: { actorUserId: userId, action: 'github.disconnected', targetType: 'github_account', targetId: account.id },
        });
      }
      return result.count === 1;
    });
    if (!disconnected) throw new HttpException({ code: 'GITHUB_NOT_CONNECTED', message: 'GitHub is not connected.' }, HttpStatus.CONFLICT);
  }

  private async persistInstallation(userId: string, installation: GithubInstallationAccess): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const account = await transaction.githubAccount.findUnique({ where: { userId } });
      if (account === null || account.unlinkedAt !== null) return false;
      const owner = await transaction.githubInstallation.findUnique({ where: { githubInstallationId: installation.id }, select: { githubAccountId: true } });
      if (owner !== null && owner.githubAccountId !== account.id) return false;
      const persisted = await transaction.githubInstallation.upsert({
        where: { githubInstallationId: installation.id },
        create: { githubInstallationId: installation.id, githubAccountId: account.id, accountType: installation.accountType, accountLogin: installation.accountLogin, suspendedAt: installation.suspended ? new Date() : null },
        update: { accountType: installation.accountType, accountLogin: installation.accountLogin, suspendedAt: installation.suspended ? new Date() : null },
      });
      await transaction.auditLog.create({
        data: { actorUserId: userId, action: 'github.installation_linked', targetType: 'github_installation', targetId: persisted.id },
      });
      return true;
    });
  }

  private async limit(scope: string, userId: string, directAddress: string): Promise<void> {
    await this.limiter.consume(`github-${scope}-address`, directAddress, LINK_LIMIT, LINK_WINDOW_MS);
    await this.limiter.consume(`github-${scope}-user`, userId, LINK_LIMIT, LINK_WINDOW_MS);
  }

  private async storeState(userId: string, sessionId: string, state: string, purpose: StatePurpose, intendedRedirect?: string): Promise<void> {
    await this.prisma.githubOauthState.create({ data: { userId, sessionId, purpose, intendedRedirect, stateTokenHash: hash(state), expiresAt: new Date(Date.now() + STATE_TTL_MS) } });
  }

  private async consumeState(state: string, session: { userId: string; sessionId: string } | null, purposes: StatePurpose | StatePurpose[]): Promise<{ userId: string; sessionId: string; purpose: StatePurpose; installationId: bigint | null } | null> {
    if (session === null) return null;
    return this.prisma.$transaction(async (transaction) => {
      const record = await transaction.githubOauthState.findUnique({ where: { stateTokenHash: hash(state) } });
      const allowed = Array.isArray(purposes) ? purposes : [purposes];
      if (record === null || record.userId !== session.userId || record.sessionId !== session.sessionId || !allowed.includes(record.purpose as StatePurpose) || record.consumedAt !== null || record.expiresAt <= new Date()) return null;
      const consumed = await transaction.githubOauthState.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
      const installationId = record.purpose === 'INSTALLATION_VERIFY' && record.intendedRedirect !== null ? BigInt(record.intendedRedirect) : null;
      return consumed.count === 1 ? { userId: record.userId, sessionId: record.sessionId, purpose: record.purpose as StatePurpose, installationId } : null;
    });
  }

  private callbackUrl(): string {
    if (this.config.github.callbackUrl === undefined) throw this.unavailable();
    return this.config.github.callbackUrl;
  }

  private appSlug(): string {
    if (this.config.github.appSlug === undefined || this.config.github.installationCallbackUrl === undefined) throw this.unavailable();
    return this.config.github.appSlug;
  }

  private unavailable(): HttpException {
    return new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'GitHub connection is unavailable.' }, HttpStatus.SERVICE_UNAVAILABLE);
  }

  private redirect(result: { result: string; reason?: string }): string {
    const url = new URL('/github', this.config.frontendOrigin);
    url.searchParams.set('result', result.result);
    if (result.reason !== undefined) url.searchParams.set('reason', result.reason);
    return url.toString();
  }

  private account(account: GithubAccount): { id: string; username: string; displayName: string | null; avatarUrl: string | null } {
    return { id: account.id, username: account.githubUsername, displayName: account.displayName, avatarUrl: account.avatarUrl };
  }

  private installationDto(installation: GithubInstallation): { id: string; accountType: 'USER' | 'ORGANIZATION'; accountLogin: string } {
    return { id: installation.id, accountType: installation.accountType, accountLogin: installation.accountLogin };
  }

  private async repositoryCounts(userId: string, installationIds: string[]): Promise<{ accessible: number; tracked: number }> {
    const [accessible, tracked] = await Promise.all([
      this.prisma.userRepository.count({ where: { userId, accessRemovedAt: null, repository: { githubInstallationId: { in: installationIds }, accessRemovedAt: null } } }),
      this.prisma.userRepository.count({ where: { userId, trackingEnabled: true, accessRemovedAt: null, repository: { githubInstallationId: { in: installationIds }, accessRemovedAt: null } } }),
    ]);
    return { accessible, tracked };
  }
}
