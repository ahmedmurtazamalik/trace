import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import type { TraceConfig } from '@trace/config';
import { TRACE_CONFIG } from '../../common/config/config.token';
import { GithubWebhookQueue } from './github-webhook.queue';

interface PushPayload {
  ref: string;
  before: string;
  after: string;
  installation: { id: number };
  repository: { id: number; full_name: string };
  sender: { id: number; login: string };
  commits: Record<string, unknown>[];
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRACE_CONFIG) private readonly config: TraceConfig,
    private readonly queue: GithubWebhookQueue,
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
      const installation = await transaction.githubInstallation.findUnique({ where: { githubInstallationId } });
      if (installation === null) {
        return { deliveryId: null };
      }
      await transaction.$queryRaw`SELECT id FROM github_installations WHERE id = ${installation.id} FOR UPDATE`;
      const repository = await transaction.repository.findUnique({ where: { githubRepositoryId } });
      if (repository === null) {
        return { deliveryId: null };
      }
      await transaction.$queryRaw`SELECT id FROM repositories WHERE id = ${repository.id} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM user_repositories WHERE repository_id = ${repository.id} FOR UPDATE`;

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
        return { deliveryId: existingDelivery.id };
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
      return { deliveryId: delivery.id };
    });
    if (durableDeliveryId.deliveryId === null) {
      return { accepted: false, reason: 'untracked' };
    }
    await this.queue.enqueue(durableDeliveryId.deliveryId);

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
      && value.commits.every((commit) => this.record(commit) !== null);
  }

  private record(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  private providerId(value: unknown): value is number {
    return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
  }
}
