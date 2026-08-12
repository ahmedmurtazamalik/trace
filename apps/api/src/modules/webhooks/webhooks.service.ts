import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@trace/database';
import type { TraceConfig } from '@trace/config';
import { TRACE_CONFIG } from '../../common/config/config.token';
import { GithubWebhookPublisher } from './github-webhook.publisher';

interface PushPayload {
  ref: string;
  before: string;
  after: string;
  installation: { id: number };
  repository: { id: number; full_name: string };
  sender: { id: number; login: string };
  commits: PushCommit[];
}

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

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRACE_CONFIG) private readonly config: TraceConfig,
    private readonly publisher: GithubWebhookPublisher,
  ) {}

  async acceptPush(deliveryId: string, signature: string, rawBody: Buffer): Promise<{ accepted: true } | { accepted: false; reason: 'untracked' }> {
    const secret = this.config.github.webhookSecret;
    if (secret === undefined || !this.validSignature(secret, signature, rawBody)) {
      throw new HttpException({ code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Webhook signature is invalid.' }, HttpStatus.UNAUTHORIZED);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw new HttpException({ code: 'WEBHOOK_PAYLOAD_INVALID', message: 'Webhook payload is invalid.' }, HttpStatus.BAD_REQUEST);
    }
    if (!this.isPushPayload(payload)) {
      throw new HttpException({ code: 'WEBHOOK_PAYLOAD_INVALID', message: 'Webhook payload is invalid.' }, HttpStatus.BAD_REQUEST);
    }

    const githubInstallationId = BigInt(payload.installation.id);
    const githubRepositoryId = BigInt(payload.repository.id);
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    const durableDeliveryId = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${deliveryId}, 0))`;
      const existingDelivery = await transaction.githubWebhookDelivery.findUnique({ where: { githubDeliveryId: deliveryId } });
      if (
        existingDelivery !== null
        && (
          existingDelivery.eventName !== 'push'
          || existingDelivery.payloadHash !== payloadHash
          || existingDelivery.githubInstallationId !== githubInstallationId
          || existingDelivery.githubRepositoryId !== githubRepositoryId
        )
      ) {
        throw new HttpException({ code: 'WEBHOOK_DELIVERY_CONFLICT', message: 'Webhook delivery ID conflicts with prior content.' }, HttpStatus.CONFLICT);
      }
      const installation = await transaction.githubInstallation.findUnique({
        where: { githubInstallationId },
        include: { githubAccount: { select: { id: true, userId: true } } },
      });
      if (installation === null) {
        return { deliveryId: null };
      }
      const repository = await transaction.repository.findUnique({ where: { githubRepositoryId } });
      if (repository === null) {
        return { deliveryId: null };
      }
      const memberships = await transaction.userRepository.findMany({
        where: { repositoryId: repository.id },
        select: { userId: true },
        orderBy: { userId: 'asc' },
      });
      const authorityUserIds = [...new Set([installation.githubAccount.userId, ...memberships.map(({ userId }) => userId)])].sort();
      await transaction.$queryRaw`SELECT id FROM users WHERE id IN (${Prisma.join(authorityUserIds)}) ORDER BY id FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM github_accounts WHERE id = ${installation.githubAccountId} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM github_installations WHERE id = ${installation.id} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM repositories WHERE id = ${repository.id} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM user_repositories WHERE repository_id = ${repository.id} ORDER BY user_id FOR UPDATE`;

      const liveRepository = await transaction.repository.findFirst({
        where: {
          id: repository.id,
          githubInstallationId: installation.id,
          accessRemovedAt: null,
          installation: {
            suspendedAt: null,
            githubAccount: { unlinkedAt: null },
          },
          users: {
            some: {
              trackingEnabled: true,
              accessRemovedAt: null,
              user: { disabledAt: null },
            },
          },
        },
      });
      if (liveRepository === null) {
        return { deliveryId: null };
      }

      if (existingDelivery !== null) {
        return { deliveryId: existingDelivery.id, shouldEnqueue: existingDelivery.status === 'pending' };
      }
      const delivery = await transaction.githubWebhookDelivery.create({
        data: {
          githubDeliveryId: deliveryId,
          eventName: 'push',
          githubInstallationId,
          githubRepositoryId,
          installationId: installation.id,
          repositoryId: repository.id,
          payloadHash,
          payload: payload as object,
        },
      });
      return { deliveryId: delivery.id, shouldEnqueue: true };
    });
    if (durableDeliveryId.deliveryId === null) {
      return { accepted: false, reason: 'untracked' };
    }
    if (durableDeliveryId.shouldEnqueue) await this.publisher.publishOneBounded(durableDeliveryId.deliveryId);

    return { accepted: true };
  }

  private validSignature(secret: string, signature: string, rawBody: Buffer): boolean {
    if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
    const received = Buffer.from(signature.slice(7), 'hex');
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  private isPushPayload(payload: unknown): payload is PushPayload {
    if (typeof payload !== 'object' || payload === null) return false;
    const value = payload as Record<string, unknown>;
    const installation = this.record(value.installation);
    const repository = this.record(value.repository);
    const sender = this.record(value.sender);
    return typeof value.ref === 'string'
      && /^refs\/(heads|tags)\/[\x20-\x7e]{1,255}$/.test(value.ref)
      && typeof value.before === 'string'
      && /^[a-f0-9]{40,64}$/i.test(value.before)
      && typeof value.after === 'string'
      && /^[a-f0-9]{40,64}$/i.test(value.after)
      && installation !== null
      && this.providerId(installation.id)
      && repository !== null
      && this.providerId(repository.id)
      && typeof repository.full_name === 'string'
      && /^[^/\s]{1,100}\/[^/\s]{1,100}$/.test(repository.full_name)
      && sender !== null
      && this.providerId(sender.id)
      && typeof sender.login === 'string'
      && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(sender.login)
      && Array.isArray(value.commits)
      && value.commits.length <= 2_048
      && value.commits.every((commit) => this.pushCommit(commit));
  }

  private pushCommit(value: unknown): value is PushCommit {
    const commit = this.record(value);
    if (commit === null) return false;
    return this.sha(commit.id)
      && this.sha(commit.tree_id)
      && typeof commit.distinct === 'boolean'
      && this.boundedString(commit.message, 65_536)
      && this.boundedString(commit.timestamp, 64)
      && !Number.isNaN(Date.parse(commit.timestamp))
      && this.httpUrl(commit.url)
      && this.pushIdentity(commit.author)
      && this.pushIdentity(commit.committer)
      && this.paths(commit.added)
      && this.paths(commit.removed)
      && this.paths(commit.modified);
  }

  private pushIdentity(value: unknown): value is PushIdentity {
    const identity = this.record(value);
    return identity !== null
      && this.boundedString(identity.name, 256)
      && this.boundedString(identity.email, 320)
      && (identity.username === null || this.boundedString(identity.username, 256));
  }

  private paths(value: unknown): value is string[] {
    return Array.isArray(value)
      && value.length <= 4_096
      && value.every((path) => this.boundedString(path, 4_096));
  }

  private httpUrl(value: unknown): value is string {
    if (!this.boundedString(value, 2_048)) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }

  private sha(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value);
  }

  private boundedString(value: unknown, maximum: number): value is string {
    return typeof value === 'string' && value.length >= 1 && value.length <= maximum;
  }

  private record(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  private providerId(value: unknown): value is number {
    return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
  }
}
