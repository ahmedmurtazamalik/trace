import type { Prisma, PrismaClient } from '@trace/database';
import type { GithubCommitEnricher, GithubCommitFacts, GithubContributorIdentity } from './github-commit.enricher';

interface PushIdentity {
  name: string;
  email: string;
  username: string | null;
}

interface PushCommit {
  id: string;
  tree_id: string;
  distinct: boolean;
  message: string;
  timestamp: string;
  url: string;
  author: PushIdentity;
  committer: PushIdentity;
  added: string[];
  removed: string[];
  modified: string[];
}

interface PushPayload {
  ref: string;
  before: string;
  after: string;
  installation: { id: number };
  repository: { id: number; full_name: string };
  sender: { id: number; login: string };
  commits: PushCommit[];
}

type Transaction = Prisma.TransactionClient;

export class GithubPushProcessor {
  private readonly inFlightEnrichment = new Map<string, { promise: Promise<GithubCommitFacts>; consumers: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly enricher?: GithubCommitEnricher,
  ) {}

  async process(deliveryId: string): Promise<void> {
    const snapshot = await this.prisma.githubWebhookDelivery.findUnique({ where: { id: deliveryId } });
    if (
      snapshot === null || snapshot.eventName !== 'push' || snapshot.repositoryId === null || snapshot.installationId === null
      || snapshot.githubInstallationId === null || snapshot.githubRepositoryId === null
    ) {
      throw new Error('Webhook delivery is unavailable for processing.');
    }
    if (snapshot.status === 'completed' || snapshot.status === 'failed') return;
    const snapshotPayload = this.payload(snapshot.payload);
    if (
      snapshot.githubInstallationId !== BigInt(snapshotPayload.installation.id)
      || snapshot.githubRepositoryId !== BigInt(snapshotPayload.repository.id)
    ) {
      throw new Error('Webhook delivery authority does not match its payload.');
    }
    const snapshotRepository = await this.prisma.repository.findUnique({ where: { id: snapshot.repositoryId } });
    if (snapshotRepository === null) throw new Error('Webhook delivery repository is unavailable.');
    const snapshotInstallation = await this.prisma.githubInstallation.findUnique({ where: { id: snapshot.installationId } });
    if (
      snapshotInstallation === null
      || snapshotInstallation.githubInstallationId !== snapshot.githubInstallationId
      || snapshotRepository.githubInstallationId !== snapshotInstallation.id
      || snapshotRepository.githubRepositoryId !== snapshot.githubRepositoryId
    ) {
      throw new Error('Webhook delivery authority does not match its repository.');
    }
    const activeAuthority = await this.prisma.userRepository.findFirst({
      where: {
        repositoryId: snapshotRepository.id,
        trackingEnabled: true,
        accessRemovedAt: null,
        user: {
          disabledAt: null,
          githubAccount: {
            is: {
              unlinkedAt: null,
              installations: { some: { id: snapshotInstallation.id, suspendedAt: null } },
            },
          },
        },
        repository: { accessRemovedAt: null },
      },
      select: { id: true },
    });
    if (activeAuthority === null) {
      await this.prisma.githubWebhookDelivery.updateMany({
        where: { id: snapshot.id, status: { in: ['pending', 'processing'] } },
        data: { status: 'failed', processedAt: new Date(), processingError: 'Webhook authority is unavailable.' },
      });
      return;
    }
    const enriched = new Map<string, GithubCommitFacts>();
    const enrichmentLeases = new Set<string>();
    try {
      if (this.enricher !== undefined) {
        for (const commit of snapshotPayload.commits) {
          const sha = commit.id.toLowerCase();
          const existing = await this.prisma.commit.findUnique({
            where: { repositoryId_sha: { repositoryId: snapshotRepository.id, sha } },
            select: { id: true },
          });
          if (existing === null) {
            const enrichmentKey = `${snapshotRepository.id}:${sha}`;
            let enrichment = this.inFlightEnrichment.get(enrichmentKey);
            if (enrichment === undefined) {
              enrichment = {
                promise: this.enricher.commit({
                  githubInstallationId: snapshot.githubInstallationId,
                  githubRepositoryId: snapshot.githubRepositoryId,
                  sha,
                }),
                consumers: 0,
              };
              this.inFlightEnrichment.set(enrichmentKey, enrichment);
            }
            if (!enrichmentLeases.has(enrichmentKey)) {
              enrichment.consumers += 1;
              enrichmentLeases.add(enrichmentKey);
            }
            enriched.set(sha, await enrichment.promise);
          }
        }
      }
      await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${deliveryId}, 0))`;
      await transaction.$queryRaw`SELECT id FROM github_webhook_deliveries WHERE id = ${deliveryId} FOR UPDATE`;
      const delivery = await transaction.githubWebhookDelivery.findUnique({ where: { id: deliveryId } });
      if (delivery === null || delivery.eventName !== 'push' || delivery.repositoryId === null || delivery.installationId === null) {
        throw new Error('Webhook delivery is unavailable for processing.');
      }
      if (delivery.status === 'completed' || delivery.status === 'failed') return;
      const lockedAuthority = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT ur.id
        FROM github_installations gi
        JOIN github_accounts ga ON ga.id = gi.github_account_id
        JOIN users u ON u.id = ga.user_id
        JOIN repositories r ON r.github_installation_id = gi.id
        JOIN user_repositories ur ON ur.repository_id = r.id AND ur.user_id = u.id
        WHERE gi.id = ${delivery.installationId}
          AND r.id = ${delivery.repositoryId}
          AND gi.suspended_at IS NULL
          AND ga.unlinked_at IS NULL
          AND u.disabled_at IS NULL
          AND r.access_removed_at IS NULL
          AND ur.access_removed_at IS NULL
          AND ur.tracking_enabled = TRUE
        FOR UPDATE OF gi, ga, u, r, ur
      `;
      if (lockedAuthority.length === 0) {
        await transaction.githubWebhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'failed', processedAt: new Date(), processingError: 'Webhook authority is unavailable.' },
        });
        return;
      }
      const payload = this.payload(delivery.payload);
      if (
        delivery.githubInstallationId !== BigInt(payload.installation.id)
        || delivery.githubRepositoryId !== BigInt(payload.repository.id)
      ) {
        throw new Error('Webhook delivery authority does not match its payload.');
      }
      const repository = await transaction.repository.findUnique({ where: { id: delivery.repositoryId } });
      const installation = await transaction.githubInstallation.findUnique({ where: { id: delivery.installationId } });
      if (repository === null || repository.githubRepositoryId !== BigInt(payload.repository.id)) {
        throw new Error('Webhook delivery repository is unavailable.');
      }
      if (
        installation === null
        || installation.githubInstallationId !== delivery.githubInstallationId
        || repository.githubInstallationId !== installation.id
      ) {
        throw new Error('Webhook delivery authority does not match its repository.');
      }

      await transaction.githubWebhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'processing', processingStartedAt: new Date(), processedAt: null, processingError: null },
      });

      const sender = await transaction.contributor.upsert({
        where: { githubUserId: BigInt(payload.sender.id) },
        update: { username: payload.sender.login },
        create: { githubUserId: BigInt(payload.sender.id), username: payload.sender.login },
      });
      await transaction.pushEvent.upsert({
        where: { githubDeliveryId: delivery.githubDeliveryId },
        update: {},
        create: {
          repositoryId: repository.id,
          githubDeliveryId: delivery.githubDeliveryId,
          ref: payload.ref,
          beforeSha: payload.before.toLowerCase(),
          afterSha: payload.after.toLowerCase(),
          senderContributorId: sender.id,
        },
      });
      const pushOccurredAt = this.pushOccurredAt(payload, delivery.receivedAt);
      await transaction.activityEvent.upsert({
        where: { sourceKey: `github:push:${delivery.githubDeliveryId}` },
        update: {},
        create: {
          sourceKey: `github:push:${delivery.githubDeliveryId}`,
          repositoryId: repository.id,
          contributorId: sender.id,
          source: 'github',
          type: 'push',
          occurredAt: pushOccurredAt,
          metadata: {
            deliveryId: delivery.githubDeliveryId,
            ref: payload.ref,
            beforeSha: payload.before.toLowerCase(),
            afterSha: payload.after.toLowerCase(),
          },
        },
      });

      for (const commit of payload.commits) {
        await this.persistCommit(transaction, repository.id, payload.ref, commit, enriched.get(commit.id.toLowerCase()));
      }
      await transaction.githubWebhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'completed', processedAt: new Date(), processingError: null },
      });
      });
    } finally {
      for (const enrichmentKey of enrichmentLeases) {
        const enrichment = this.inFlightEnrichment.get(enrichmentKey);
        if (enrichment === undefined) continue;
        enrichment.consumers -= 1;
        if (enrichment.consumers === 0) this.inFlightEnrichment.delete(enrichmentKey);
      }
    }
  }

  private async persistCommit(
    transaction: Transaction,
    repositoryId: string,
    ref: string,
    commit: PushCommit,
    facts?: GithubCommitFacts,
  ): Promise<void> {
    const sha = commit.id.toLowerCase();
    const occurredAt = facts?.committedAt ?? new Date(commit.timestamp);
    const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null;
    const fileStatuses = new Map<string, {
      status: string;
      additions: number | null;
      deletions: number | null;
      previousPath: string | null;
    }>();
    if (facts === undefined) {
      for (const path of commit.added) fileStatuses.set(path, { status: 'added', additions: null, deletions: null, previousPath: null });
      for (const path of commit.removed) fileStatuses.set(path, { status: 'removed', additions: null, deletions: null, previousPath: null });
      for (const path of commit.modified) fileStatuses.set(path, { status: 'modified', additions: null, deletions: null, previousPath: null });
    } else {
      for (const file of facts.files) fileStatuses.set(file.path, file);
    }
    const authorContributorId = await this.contributorId(transaction, facts?.author ?? null);
    const committerContributorId = await this.contributorId(transaction, facts?.committer ?? null);
    const persisted = await transaction.commit.upsert({
      where: { repositoryId_sha: { repositoryId, sha } },
      update: {},
      create: {
        repositoryId,
        sha,
        message: commit.message,
        authorName: commit.author.name,
        authorEmail: commit.author.email,
        authorUsername: commit.author.username,
        committerName: commit.committer.name,
        committerEmail: commit.committer.email,
        committerUsername: commit.committer.username,
        authorContributorId,
        committerContributorId,
        authoredAt: facts?.authoredAt ?? occurredAt,
        committedAt: facts?.committedAt ?? occurredAt,
        branch,
        additions: facts?.additions,
        deletions: facts?.deletions,
        changedFiles: fileStatuses.size,
      },
    });
    for (const [path, file] of fileStatuses) {
      await transaction.commitFile.upsert({
        where: { commitId_path: { commitId: persisted.id, path } },
        update: {},
        create: {
          commitId: persisted.id,
          path,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          previousPath: file.previousPath,
        },
      });
    }
    await transaction.activityEvent.upsert({
      where: { sourceKey: `github:commit:${repositoryId}:${sha}` },
      update: {},
      create: {
        sourceKey: `github:commit:${repositoryId}:${sha}`,
        repositoryId,
        contributorId: authorContributorId,
        source: 'github',
        type: 'commit',
        occurredAt,
        metadata: {
          sha,
          message: commit.message,
          branch,
          additions: facts?.additions ?? null,
          deletions: facts?.deletions ?? null,
          changedFiles: fileStatuses.size,
          url: commit.url,
        },
      },
    });
  }

  private async contributorId(transaction: Transaction, identity: GithubContributorIdentity | null): Promise<string | null> {
    if (identity === null) return null;
    const contributor = await transaction.contributor.upsert({
      where: { githubUserId: identity.githubUserId },
      update: {
        username: identity.username,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
      },
      create: identity,
    });
    return contributor.id;
  }

  private pushOccurredAt(payload: PushPayload, fallback: Date): Date {
    const times = payload.commits.map(({ timestamp }) => Date.parse(timestamp)).filter((value) => Number.isFinite(value));
    return times.length === 0 ? fallback : new Date(Math.max(...times));
  }

  private payload(value: Prisma.JsonValue): PushPayload {
    const payload = value as unknown as PushPayload;
    if (
      typeof payload !== 'object' || payload === null
      || !this.boundedString(payload.ref, 1, 1_024)
      || !this.sha(payload.before)
      || !this.sha(payload.after)
      || !this.positiveSafeInteger(payload.installation?.id)
      || !this.positiveSafeInteger(payload.repository?.id)
      || !this.boundedString(payload.repository?.full_name, 1, 512)
      || !this.positiveSafeInteger(payload.sender?.id)
      || !this.boundedString(payload.sender?.login, 1, 256)
      || !Array.isArray(payload.commits) || payload.commits.length > 2_048
      || !payload.commits.every((commit) => this.commitPayload(commit))
    ) {
      throw new Error('Webhook delivery payload is unavailable for processing.');
    }
    return payload;
  }

  private commitPayload(commit: unknown): commit is PushCommit {
    const value = commit as PushCommit;
    return typeof value === 'object' && value !== null
      && this.sha(value.id)
      && this.sha(value.tree_id)
      && typeof value.distinct === 'boolean'
      && this.boundedString(value.message, 0, 65_536)
      && this.boundedString(value.timestamp, 1, 128) && Number.isFinite(Date.parse(value.timestamp))
      && this.httpUrl(value.url)
      && this.pushIdentity(value.author)
      && this.pushIdentity(value.committer)
      && this.pathArray(value.added)
      && this.pathArray(value.removed)
      && this.pathArray(value.modified);
  }

  private pushIdentity(value: unknown): value is PushIdentity {
    const identity = value as PushIdentity;
    return typeof identity === 'object' && identity !== null
      && this.boundedString(identity.name, 0, 256)
      && this.boundedString(identity.email, 0, 320)
      && (identity.username === null || this.boundedString(identity.username, 1, 256));
  }

  private pathArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.length <= 4_096 && value.every((path) => this.repositoryPath(path));
  }

  private repositoryPath(value: unknown): value is string {
    if (!this.boundedString(value, 1, 4_096) || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
    return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  }

  private sha(value: unknown): value is string {
    return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
  }

  private httpUrl(value: unknown): value is string {
    if (!this.boundedString(value, 1, 2_048)) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  private positiveSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
  }

  private boundedString(value: unknown, minimum: number, maximum: number): value is string {
    return typeof value === 'string' && value.length >= minimum && value.length <= maximum && !value.includes('\0');
  }
}
