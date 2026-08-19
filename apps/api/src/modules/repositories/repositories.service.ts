import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TraceConfig } from '@trace/config';
import { Prisma, PrismaService, type Repository, type UserRepository } from '@trace/database';
import type { GithubAuthorizationAdapter, GithubRepositoryAccess } from '@trace/github';
import type { RepositoryDetailResponse, RepositoryForgottenResponse, RepositoryListQuery, RepositoryListResponse, RepositoryMembershipResponse, RepositorySummary, RepositorySynchronizationResponse, RepositoryTrackingResponse } from '@trace/shared';
import { repositoryListQuerySchema } from '@trace/shared';
import { GITHUB_AUTHORIZATION_ADAPTER } from '../github/github.tokens';
import { TRACE_CONFIG } from '../../common/config/config.token';

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GITHUB_AUTHORIZATION_ADAPTER) private readonly github: GithubAuthorizationAdapter,
    @Inject(TRACE_CONFIG) private readonly config: TraceConfig,
  ) {}

  async list(userId: string, input: unknown): Promise<RepositoryListResponse> {
    const query = this.listQuery(input);
    const fingerprint = this.cursorFingerprint(userId, query);
    const cursor = this.decodeCursor(query.cursor, fingerprint);
    const search = query.search;
    const rows = await this.prisma.userRepository.findMany({
      where: {
        userId,
        forgottenAt: null,
        removedAt: query.visibility === 'removed' ? { not: null } : null,
        ...(search === undefined ? {} : {
          repository: {
            OR: [
              { owner: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { fullName: { contains: search, mode: 'insensitive' } },
            ],
          },
        }),
        ...(cursor === null ? {} : {
          OR: [
            { repository: { fullName: { gt: cursor.fullName } } },
            { repository: { fullName: cursor.fullName }, repositoryId: { gt: cursor.id } },
          ],
        }),
      },
      include: {
        repository: {
          include: {
            installation: { include: { githubAccount: true } },
          },
        },
      },
      orderBy: [{ repository: { fullName: 'asc' } }, { repositoryId: 'asc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const summaries = await this.activitySummaries(userId, page.map((row) => row.repositoryId));
    const items = page.map((row) => this.summary(row, userId, summaries.get(row.repositoryId)));
    const hasNextPage = rows.length > query.limit;
    const last = page.at(-1);
    return {
      items,
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && last !== undefined ? this.encodeCursor(last.repository.fullName, last.repositoryId, fingerprint) : null,
      },
    };
  }

  async detail(userId: string, repositoryId: string): Promise<RepositoryDetailResponse> {
    const row = await this.prisma.userRepository.findFirst({
      where: { userId, repositoryId, forgottenAt: null },
      include: {
        repository: {
          include: {
            installation: { include: { githubAccount: true } },
          },
        },
      },
    });
    if (row === null || row.forgottenAt !== null) throw this.error('REPOSITORY_NOT_FOUND', 'Repository not found.', HttpStatus.NOT_FOUND);
    const activitySummary = (await this.activitySummaries(userId, [repositoryId])).get(repositoryId);
    return { repository: this.summary(row, userId, activitySummary) };
  }

  async setTracking(userId: string, repositoryId: string, enabled: boolean): Promise<RepositoryTrackingResponse> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM user_repositories WHERE user_id = ${userId} AND repository_id = ${repositoryId} FOR UPDATE`;
      const row = await transaction.userRepository.findUnique({
        where: { userId_repositoryId: { userId, repositoryId } },
        include: { repository: { include: { installation: { include: { githubAccount: true } } } } },
      });
      if (row === null || row.forgottenAt !== null) throw this.error('REPOSITORY_NOT_FOUND', 'Repository not found.', HttpStatus.NOT_FOUND);
      if (enabled && row.removedAt !== null) {
        throw this.error('REPOSITORY_REMOVED', 'Restore the repository before enabling tracking.', HttpStatus.CONFLICT);
      }
      if (enabled && (
        row.accessRemovedAt !== null ||
        row.repository.accessRemovedAt !== null ||
        row.repository.installation.suspendedAt !== null ||
        row.repository.installation.githubAccount.unlinkedAt !== null ||
        row.repository.installation.githubAccount.userId !== userId
      )) {
        throw this.error('REPOSITORY_ACCESS_REMOVED', 'Repository access has been removed.', HttpStatus.CONFLICT);
      }
      await transaction.userRepository.update({
        where: { userId_repositoryId: { userId, repositoryId } },
        data: { trackingEnabled: enabled },
      });
      if (row.trackingEnabled !== enabled) {
        await transaction.auditLog.create({
          data: {
            actorUserId: userId,
            action: enabled ? 'repository.tracking_enabled' : 'repository.tracking_disabled',
            targetType: 'repository',
            targetId: repositoryId,
          },
        });
      }
      return { repositoryId, trackingEnabled: enabled };
    });
  }

  async setRemoved(userId: string, repositoryId: string, removed: boolean): Promise<RepositoryMembershipResponse> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM user_repositories WHERE user_id = ${userId} AND repository_id = ${repositoryId} FOR UPDATE`;
      const row = await transaction.userRepository.findUnique({
        where: { userId_repositoryId: { userId, repositoryId } },
      });
      if (row === null || row.forgottenAt !== null) throw this.error('REPOSITORY_NOT_FOUND', 'Repository not found.', HttpStatus.NOT_FOUND);
      const changed = removed ? row.removedAt === null : row.removedAt !== null;
      const updated = await transaction.userRepository.update({
        where: { userId_repositoryId: { userId, repositoryId } },
        data: removed
          ? { removedAt: row.removedAt ?? new Date(), trackingEnabled: false }
          : { removedAt: null, trackingEnabled: false },
      });
      if (changed) {
        await transaction.auditLog.create({
          data: {
            actorUserId: userId,
            action: removed ? 'repository.removed' : 'repository.restored',
            targetType: 'repository',
            targetId: repositoryId,
          },
        });
      }
      return { repositoryId, trackingEnabled: updated.trackingEnabled, removed: updated.removedAt !== null };
    });
  }

  async forget(userId: string, repositoryId: string): Promise<RepositoryForgottenResponse> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM user_repositories WHERE user_id = ${userId} AND repository_id = ${repositoryId} FOR UPDATE`;
      const row = await transaction.userRepository.findUnique({
        where: { userId_repositoryId: { userId, repositoryId } },
      });
      if (row === null || row.forgottenAt !== null) {
        throw this.error('REPOSITORY_NOT_FOUND', 'Repository not found.', HttpStatus.NOT_FOUND);
      }
      if (row.removedAt === null) {
        throw this.error('REPOSITORY_NOT_REMOVED', 'Remove the repository before forgetting it.', HttpStatus.CONFLICT);
      }
      const assignments = await transaction.workspaceRepository.findMany({
        where: { repositoryId },
        select: {
          id: true,
          workspace: {
            select: { memberships: { where: { userId, role: 'MANAGER' }, select: { id: true } } },
          },
        },
      });
      if (assignments.some((assignment) => assignment.workspace.memberships.length === 0)) {
        throw this.error('REPOSITORY_IN_USE', 'Remove the repository from Workspaces you do not manage before forgetting it.', HttpStatus.CONFLICT);
      }
      if (assignments.length > 0) {
        await transaction.workspaceRepository.deleteMany({ where: { id: { in: assignments.map((assignment) => assignment.id) } } });
      }
      await transaction.userRepository.update({
        where: { userId_repositoryId: { userId, repositoryId } },
        data: { trackingEnabled: false, forgottenAt: new Date() },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'repository.forgotten',
          targetType: 'repository',
          targetId: repositoryId,
          metadata: { removedWorkspaceAssignmentCount: assignments.length },
        },
      });
      return { repositoryId, forgotten: true };
    });
  }

  async synchronize(userId: string): Promise<RepositorySynchronizationResponse> {
    const account = await this.prisma.githubAccount.findUnique({
      where: { userId },
      include: { installations: true },
    });
    if (account === null || account.unlinkedAt !== null || account.installations.length === 0) {
      throw this.error('GITHUB_INSTALLATION_REQUIRED', 'An active GitHub App installation is required.', HttpStatus.CONFLICT);
    }
    const activeInstallations = account.installations.filter((installation) => installation.suspendedAt === null);
    if (activeInstallations.length === 0) {
      throw this.error('GITHUB_INSTALLATION_SUSPENDED', 'The GitHub App installation is suspended.', HttpStatus.CONFLICT);
    }

    let accessibleRepositoryCount = 0;
    for (const installation of activeInstallations) {
      const reservation = await this.reserveSynchronization(userId, account.id, installation.id);
      let repositories: GithubRepositoryAccess[];
      try {
        repositories = await this.github.repositories(installation.githubInstallationId);
      } catch {
        throw this.error('SERVICE_UNAVAILABLE', 'Repository synchronization is unavailable.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      const acceptedRepositoryCount = await this.persistSynchronization(userId, account.id, installation.id, reservation.generation, reservation.sequence, repositories);
      accessibleRepositoryCount += acceptedRepositoryCount;
    }
    const [activeRepositoryCount, removedRepositoryCount] = await Promise.all([
      this.prisma.userRepository.count({ where: { userId, forgottenAt: null, removedAt: null } }),
      this.prisma.userRepository.count({ where: { userId, forgottenAt: null, removedAt: { not: null } } }),
    ]);
    return { accessibleRepositoryCount, activeRepositoryCount, removedRepositoryCount };
  }

  private async reserveSynchronization(userId: string, githubAccountId: string, installationId: string): Promise<{ generation: number; sequence: bigint }> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM github_installations WHERE id = ${installationId} FOR UPDATE`;
      const installation = await transaction.githubInstallation.findFirst({
        where: { id: installationId, githubAccountId, suspendedAt: null, githubAccount: { userId, unlinkedAt: null } },
      });
      if (installation === null) {
        throw this.error('GITHUB_INSTALLATION_REQUIRED', 'An active GitHub App installation is required.', HttpStatus.CONFLICT);
      }
      const updated = await transaction.githubInstallation.update({
        where: { id: installationId },
        data: { syncGeneration: { increment: 1 } },
        select: { syncGeneration: true },
      });
      const sequenceRows = await transaction.$queryRaw<Array<{ sequence: bigint }>>`
        SELECT nextval('repository_sync_sequence') AS sequence
      `;
      const sequence = sequenceRows[0]?.sequence;
      if (sequence === undefined) throw new Error('Repository synchronization sequence unavailable');
      return { generation: updated.syncGeneration, sequence };
    });
  }

  private async persistSynchronization(
    userId: string,
    githubAccountId: string,
    installationId: string,
    generation: number,
    sequence: bigint,
    repositories: GithubRepositoryAccess[],
  ): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM github_installations WHERE id = ${installationId} FOR UPDATE`;
      const liveInstallation = await transaction.githubInstallation.findFirst({
        where: {
          id: installationId,
          githubAccountId,
          suspendedAt: null,
          syncGeneration: generation,
          githubAccount: { userId, unlinkedAt: null },
        },
      });
      if (liveInstallation === null) {
        throw this.error('GITHUB_INSTALLATION_REQUIRED', 'An active GitHub App installation is required.', HttpStatus.CONFLICT);
      }

      const externalIds = repositories.map((repository) => repository.id);
      const currentlyOwned = await transaction.repository.findMany({
        where: { githubInstallationId: installationId },
        select: { id: true, githubRepositoryId: true, updatedAt: true },
      });
      const lockIds = [...new Set([...externalIds, ...currentlyOwned.map((repository) => repository.githubRepositoryId)])]
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
      if (lockIds.length > 0) {
        await transaction.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(repository_id)
            FROM unnest(ARRAY[${Prisma.join(lockIds)}]::bigint[]) AS lock_ids(repository_id)
            ORDER BY repository_id`,
        );
      }
      const orderedRepositories = [...repositories].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      let acceptedRepositoryCount = 0;
      for (const repository of orderedRepositories) {
        const existing = await transaction.repository.findUnique({
          where: { githubRepositoryId: repository.id },
          select: { id: true, githubInstallationId: true, lastSyncSequence: true, updatedAt: true },
        });
        if (existing !== null && existing.lastSyncSequence > sequence) continue;
        if (existing !== null && existing.githubInstallationId !== installationId) {
          await transaction.userRepository.updateMany({
            where: { repositoryId: existing.id, accessRemovedAt: null },
            data: { accessRemovedAt: existing.updatedAt },
          });
        }
        const persisted = await transaction.repository.upsert({
          where: { githubRepositoryId: repository.id },
          create: {
            githubRepositoryId: repository.id,
            githubInstallationId: installationId,
            owner: repository.owner,
            name: repository.name,
            fullName: repository.fullName,
            private: repository.private,
            defaultBranch: repository.defaultBranch,
            htmlUrl: repository.htmlUrl,
            accessRemovedAt: null,
            lastSyncSequence: sequence,
          },
          update: {
            githubInstallationId: installationId,
            owner: repository.owner,
            name: repository.name,
            fullName: repository.fullName,
            private: repository.private,
            defaultBranch: repository.defaultBranch,
            htmlUrl: repository.htmlUrl,
            accessRemovedAt: null,
            lastSyncSequence: sequence,
          },
        });
        const existingMembership = await transaction.userRepository.findUnique({
          where: { userId_repositoryId: { userId, repositoryId: persisted.id } },
          select: { accessRemovedAt: true },
        });
        await transaction.userRepository.upsert({
          where: { userId_repositoryId: { userId, repositoryId: persisted.id } },
          create: { userId, repositoryId: persisted.id, trackingEnabled: false, accessRemovedAt: null },
          update: existingMembership?.accessRemovedAt === null
            ? { accessRemovedAt: null }
            : { accessRemovedAt: null, createdAt: new Date() },
        });
        acceptedRepositoryCount += 1;
      }
      const removableRepositories = await transaction.repository.findMany({
        where: {
          githubInstallationId: installationId,
          accessRemovedAt: null,
          lastSyncSequence: { lt: sequence },
          ...(externalIds.length === 0 ? {} : { githubRepositoryId: { notIn: externalIds } }),
        },
        select: { id: true, updatedAt: true },
      });
      const removableIds = removableRepositories.map((repository) => repository.id);
      if (removableIds.length > 0) {
        for (const repository of removableRepositories) {
          await transaction.repository.updateMany({
            where: { id: repository.id, lastSyncSequence: { lt: sequence } },
            data: { accessRemovedAt: repository.updatedAt, lastSyncSequence: sequence },
          });
          await transaction.userRepository.updateMany({
            where: { userId, accessRemovedAt: null, repositoryId: repository.id },
            data: { accessRemovedAt: repository.updatedAt },
          });
        }
      }
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'repositories.synchronized',
          targetType: 'github_installation',
          targetId: installationId,
          metadata: { accessibleRepositoryCount: acceptedRepositoryCount, removedRepositoryCount: removableIds.length },
        },
      });
      return acceptedRepositoryCount;
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  private summary(
    row: UserRepository & {
      repository: Repository & {
        installation: { suspendedAt: Date | null; githubAccount: { unlinkedAt: Date | null; userId: string } };
      };
    },
    userId: string,
    activitySummary: { lastActivityAt: Date | null; contributorCount: number } | undefined,
  ): RepositorySummary {
    const repository = row.repository;
    return {
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
      fullName: repository.fullName,
      private: repository.private,
      defaultBranch: repository.defaultBranch,
      url: repository.htmlUrl,
      accessible: row.accessRemovedAt === null && repository.accessRemovedAt === null && repository.installation.suspendedAt === null && repository.installation.githubAccount.unlinkedAt === null && repository.installation.githubAccount.userId === userId,
      trackingEnabled: row.userId === userId && row.trackingEnabled,
      removed: row.removedAt !== null,
      lastActivityAt: activitySummary?.lastActivityAt?.toISOString() ?? null,
      contributorCount: activitySummary?.contributorCount ?? 0,
    };
  }

  private async activitySummaries(
    userId: string,
    repositoryIds: string[],
  ): Promise<Map<string, { lastActivityAt: Date | null; contributorCount: number }>> {
    if (repositoryIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ repositoryId: string; lastActivityAt: Date | null; contributorCount: bigint }>>(Prisma.sql`
      SELECT
        ur.repository_id AS "repositoryId",
        MAX(ae.occurred_at) AS "lastActivityAt",
        COUNT(DISTINCT ae.contributor_id) AS "contributorCount"
      FROM user_repositories ur
      LEFT JOIN activity_events ae
        ON ae.repository_id = ur.repository_id
       AND ae.occurred_at >= ur.created_at
       AND (ur.access_removed_at IS NULL OR ae.occurred_at <= ur.access_removed_at)
       AND ae.source::text = 'github'
       AND ae.type::text IN ('commit', 'push', 'pull_request')
      WHERE ur.user_id = ${userId}
        AND ur.repository_id IN (${Prisma.join(repositoryIds)})
      GROUP BY ur.repository_id
    `);
    return new Map(rows.map((row) => [row.repositoryId, {
      lastActivityAt: row.lastActivityAt,
      contributorCount: Number(row.contributorCount),
    }]));
  }

  private listQuery(input: unknown): RepositoryListQuery {
    const parsed = repositoryListQuerySchema.safeParse(input);
    if (!parsed.success) throw this.error('VALIDATION_ERROR', 'Request validation failed.', HttpStatus.BAD_REQUEST);
    return parsed.data;
  }

  private cursorFingerprint(userId: string, query: RepositoryListQuery): string {
    return JSON.stringify({ version: 1, userId, search: query.search ?? null, visibility: query.visibility, limit: query.limit });
  }

  private encodeCursor(fullName: string, id: string, fingerprint: string): string {
    const payload = Buffer.from(JSON.stringify({ version: 1, fullName, id, fingerprint })).toString('base64url');
    return `${payload}.${this.cursorSignature(payload)}`;
  }

  private decodeCursor(cursor: string | undefined, fingerprint: string): { fullName: string; id: string } | null {
    if (cursor === undefined) return null;
    try {
      if (cursor.length > 2_048) throw new Error('cursor too large');
      const parts = cursor.split('.');
      if (parts.length !== 2) throw new Error('invalid cursor');
      const [payload, signature] = parts as [string, string];
      if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
        throw new Error('invalid cursor encoding');
      }
      const decoded = Buffer.from(payload, 'base64url');
      if (decoded.toString('base64url') !== payload) throw new Error('non-canonical cursor');
      const expected = Buffer.from(this.cursorSignature(payload), 'base64url');
      const supplied = Buffer.from(signature, 'base64url');
      if (supplied.toString('base64url') !== signature) throw new Error('non-canonical signature');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('invalid signature');
      const value = JSON.parse(decoded.toString('utf8')) as unknown;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid cursor');
      const encoded = value as { version?: unknown; fullName?: unknown; id?: unknown; fingerprint?: unknown };
      if (
        encoded.version !== 1 ||
        typeof encoded.fullName !== 'string' || encoded.fullName.length === 0 || encoded.fullName.length > 512 ||
        typeof encoded.id !== 'string' || encoded.id.length === 0 || encoded.id.length > 256 ||
        encoded.fingerprint !== fingerprint
      ) throw new Error('invalid cursor');
      return { fullName: encoded.fullName, id: encoded.id };
    } catch {
      throw this.error('VALIDATION_ERROR', 'Request validation failed.', HttpStatus.BAD_REQUEST);
    }
  }

  private cursorSignature(payload: string): string {
    const secret = this.config.sessionSecret;
    if (secret === undefined) throw new Error('Repository cursor signing is unavailable.');
    return createHmac('sha256', secret).update(`repository-cursor:v1:${payload}`).digest('base64url');
  }

  private error(code: string, message: string, status: HttpStatus): HttpException {
    return new HttpException({ code, message }, status);
  }
}
