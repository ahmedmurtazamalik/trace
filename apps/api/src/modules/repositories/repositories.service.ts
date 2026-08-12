import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaService, type Repository, type UserRepository } from '@trace/database';
import type { GithubAuthorizationAdapter, GithubRepositoryAccess } from '@trace/github';
import type { RepositoryDetailResponse, RepositoryListQuery, RepositoryListResponse, RepositorySummary, RepositoryTrackingResponse } from '@trace/shared';
import { repositoryListQuerySchema } from '@trace/shared';
import { GITHUB_AUTHORIZATION_ADAPTER } from '../github/github.tokens';

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GITHUB_AUTHORIZATION_ADAPTER) private readonly github: GithubAuthorizationAdapter,
  ) {}

  async list(userId: string, input: unknown): Promise<RepositoryListResponse> {
    const query = this.listQuery(input);
    const cursor = this.decodeCursor(query.cursor, query.search ?? null);
    const search = query.search;
    const rows = await this.prisma.userRepository.findMany({
      where: {
        userId,
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
        nextCursor: hasNextPage && last !== undefined ? this.encodeCursor(last.repository.fullName, last.repositoryId, search ?? null) : null,
      },
    };
  }

  async detail(userId: string, repositoryId: string): Promise<RepositoryDetailResponse> {
    const row = await this.prisma.userRepository.findUnique({
      where: { userId_repositoryId: { userId, repositoryId } },
      include: {
        repository: {
          include: {
            installation: { include: { githubAccount: true } },
          },
        },
      },
    });
    if (row === null) throw this.error('REPOSITORY_NOT_FOUND', 'Repository not found.', HttpStatus.NOT_FOUND);
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
      if (row === null) throw this.error('REPOSITORY_NOT_FOUND', 'Repository not found.', HttpStatus.NOT_FOUND);
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
      return { repositoryId, trackingEnabled: enabled };
    });
  }

  async synchronize(userId: string): Promise<{ accessibleRepositoryCount: number }> {
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
    return { accessibleRepositoryCount };
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

      const synchronizedAt = new Date();
      const externalIds = repositories.map((repository) => repository.id);
      const currentlyOwned = await transaction.repository.findMany({
        where: { githubInstallationId: installationId },
        select: { githubRepositoryId: true },
      });
      const lockIds = [...new Set([...externalIds, ...currentlyOwned.map((repository) => repository.githubRepositoryId)])]
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
      for (const repositoryId of lockIds) {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${repositoryId})`;
      }
      const orderedRepositories = [...repositories].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      let acceptedRepositoryCount = 0;
      for (const repository of orderedRepositories) {
        const existing = await transaction.repository.findUnique({
          where: { githubRepositoryId: repository.id },
          select: { id: true, githubInstallationId: true, lastSyncSequence: true },
        });
        if (existing !== null && existing.lastSyncSequence > sequence) continue;
        if (existing !== null && existing.githubInstallationId !== installationId) {
          await transaction.userRepository.updateMany({
            where: { repositoryId: existing.id, accessRemovedAt: null },
            data: { accessRemovedAt: synchronizedAt },
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
        await transaction.userRepository.upsert({
          where: { userId_repositoryId: { userId, repositoryId: persisted.id } },
          create: { userId, repositoryId: persisted.id, trackingEnabled: false, accessRemovedAt: null },
          update: { accessRemovedAt: null },
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
        select: { id: true },
      });
      const removableIds = removableRepositories.map((repository) => repository.id);
      if (removableIds.length > 0) {
        await transaction.repository.updateMany({
          where: { id: { in: removableIds }, lastSyncSequence: { lt: sequence } },
          data: { accessRemovedAt: synchronizedAt, lastSyncSequence: sequence },
        });
        await transaction.userRepository.updateMany({
          where: { userId, accessRemovedAt: null, repositoryId: { in: removableIds } },
          data: { accessRemovedAt: synchronizedAt },
        });
      }
      return acceptedRepositoryCount;
    });
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
       AND (ur.access_removed_at IS NULL OR ae.occurred_at <= ur.access_removed_at)
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

  private encodeCursor(fullName: string, id: string, search: string | null): string {
    return Buffer.from(JSON.stringify({ fullName, id, search })).toString('base64url');
  }

  private decodeCursor(cursor: string | undefined, search: string | null): { fullName: string; id: string } | null {
    if (cursor === undefined) return null;
    try {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
      if (
        typeof value !== 'object' || value === null ||
        typeof (value as { fullName?: unknown }).fullName !== 'string' ||
        typeof (value as { id?: unknown }).id !== 'string' ||
        (value as { search?: unknown }).search !== search
      ) throw new Error('invalid cursor');
      return value as { fullName: string; id: string };
    } catch {
      throw this.error('VALIDATION_ERROR', 'Request validation failed.', HttpStatus.BAD_REQUEST);
    }
  }

  private error(code: string, message: string, status: HttpStatus): HttpException {
    return new HttpException({ code, message }, status);
  }
}
