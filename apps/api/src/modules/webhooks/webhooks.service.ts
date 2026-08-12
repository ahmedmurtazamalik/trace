import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import type { TraceConfig } from '@trace/config';
import { TRACE_CONFIG } from '../../common/config/config.token';
import { GithubWebhookQueue } from './github-webhook.queue';

interface PushPayload {
  installation: { id: number };
  repository: { id: number; full_name: string };
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRACE_CONFIG) private readonly config: TraceConfig,
    private readonly queue: GithubWebhookQueue,
  ) {}

  async acceptPush(deliveryId: string, signature: string, rawBody: Buffer, payload: unknown): Promise<{ accepted: true } | { accepted: false; reason: 'untracked' }> {
    const secret = this.config.github.webhookSecret;
    if (secret === undefined || !this.validSignature(secret, signature, rawBody)) {
      throw new HttpException({ code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Webhook signature is invalid.' }, HttpStatus.UNAUTHORIZED);
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
      if (existingDelivery !== null) {
        if (
          existingDelivery.eventName !== 'push'
          || existingDelivery.payloadHash !== payloadHash
          || existingDelivery.githubInstallationId !== githubInstallationId
          || existingDelivery.githubRepositoryId !== githubRepositoryId
        ) {
          throw new HttpException({ code: 'WEBHOOK_DELIVERY_CONFLICT', message: 'Webhook delivery ID conflicts with prior content.' }, HttpStatus.CONFLICT);
        }
        return { deliveryId: existingDelivery.id };
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

      const delivery = await transaction.githubWebhookDelivery.create({
        data: {
          githubDeliveryId: deliveryId,
          eventName: 'push',
          githubInstallationId,
          githubRepositoryId,
          installationId: installation.id,
          repositoryId: repository.id,
          payloadHash,
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
    const installation = value.installation;
    const repository = value.repository;
    return typeof installation === 'object' && installation !== null
      && Number.isSafeInteger((installation as Record<string, unknown>).id)
      && typeof repository === 'object' && repository !== null
      && Number.isSafeInteger((repository as Record<string, unknown>).id)
      && typeof (repository as Record<string, unknown>).full_name === 'string';
  }
}
