import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService, type Prisma } from '@trace/database';
import { GithubWebhookQueue } from './github-webhook.queue';

const PUBLISH_INTERVAL_MS = 5_000;
const REQUEST_PUBLISH_TIMEOUT_MS = 1_000;
const PUBLICATION_TRANSACTION_TIMEOUT_MS = REQUEST_PUBLISH_TIMEOUT_MS + 500;
const PUBLISH_BATCH_SIZE = 100;

@Injectable()
export class GithubWebhookPublisher implements OnApplicationBootstrap, OnModuleDestroy {
  private interval: NodeJS.Timeout | undefined;
  private reconciliation: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: GithubWebhookQueue,
  ) {}

  onApplicationBootstrap(): void {
    void this.publishOwed().catch(() => undefined);
    this.interval = setInterval(() => {
      void this.publishOwed().catch(() => undefined);
    }, PUBLISH_INTERVAL_MS);
    this.interval.unref();
  }

  async publishOneBounded(deliveryId: string): Promise<void> {
    await this.withTimeout(this.publishOne(deliveryId), REQUEST_PUBLISH_TIMEOUT_MS).catch(() => undefined);
  }

  async publishOwed(): Promise<void> {
    if (this.reconciliation !== undefined) return this.reconciliation;
    this.reconciliation = this.reconcile();
    try {
      await this.reconciliation;
    } finally {
      this.reconciliation = undefined;
    }
  }

  private async reconcile(): Promise<void> {
    const deliveries = await this.prisma.githubWebhookDelivery.findMany({
      where: { status: 'pending' },
      orderBy: [
        { publishedAt: { sort: 'asc', nulls: 'first' } },
        { receivedAt: 'asc' },
      ],
      take: PUBLISH_BATCH_SIZE,
      select: { id: true },
    });
    const attempted: string[] = [];
    for (const delivery of deliveries) {
      if (await this.markAttempt(delivery.id).catch(() => false)) attempted.push(delivery.id);
    }
    const [oldest, ...remaining] = attempted;
    if (oldest !== undefined) await this.publishAttempt(oldest).catch(() => undefined);
    await Promise.all(remaining.map(async (deliveryId) => {
      await this.publishAttempt(deliveryId).catch(() => undefined);
    }));
  }

  onModuleDestroy(): void {
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
  }

  private async publishOne(deliveryId: string): Promise<void> {
    if (!await this.markAttempt(deliveryId)) return;
    await this.publishAttempt(deliveryId);
  }

  private async markAttempt(deliveryId: string): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      if (!await this.lockCurrentAuthority(transaction, deliveryId)) return false;
      await transaction.githubWebhookDelivery.update({
        where: { id: deliveryId },
        data: { publishedAt: new Date() },
      });
      return true;
    });
  }

  private async publishAttempt(deliveryId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      if (!await this.lockCurrentAuthority(transaction, deliveryId)) return;
      await this.withTimeout(this.queue.enqueue(deliveryId), REQUEST_PUBLISH_TIMEOUT_MS);
    }, {
      maxWait: REQUEST_PUBLISH_TIMEOUT_MS,
      timeout: PUBLICATION_TRANSACTION_TIMEOUT_MS,
    });
  }

  private async lockCurrentAuthority(transaction: Prisma.TransactionClient, deliveryId: string): Promise<boolean> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${deliveryId}, 0))`;
    await transaction.$queryRaw`SELECT id FROM github_webhook_deliveries WHERE id = ${deliveryId} FOR UPDATE`;
    const delivery = await transaction.githubWebhookDelivery.findFirst({
      where: { id: deliveryId, status: 'pending' },
      select: { id: true, installationId: true, repositoryId: true },
    });
    if (delivery === null) return false;
    if (delivery.installationId === null || delivery.repositoryId === null) {
      await transaction.githubWebhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'failed', processedAt: new Date(), processingError: 'Webhook authority is unavailable.' },
      });
      return false;
    }
    const authority = await transaction.$queryRaw<Array<{ id: string }>>`
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
    if (authority.length > 0) return true;
    await transaction.githubWebhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed', processedAt: new Date(), processingError: 'Webhook authority is unavailable.' },
    });
    return false;
  }

  private async withTimeout(operation: Promise<void>, timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Webhook queue publication timed out.')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
