import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService, type Prisma } from '@trace/database';
import { GithubWebhookQueue } from './github-webhook.queue';

const PUBLISH_INTERVAL_MS = 5_000;
const REQUEST_PUBLISH_TIMEOUT_MS = 1_000;
const RECONCILIATION_PUBLISH_TIMEOUT_MS = 3_000;
const PUBLICATION_TRANSACTION_TIMEOUT_MS = 2_500;
const PUBLISH_BATCH_SIZE = 100;

@Injectable()
export class GithubWebhookPublisher implements OnApplicationBootstrap, OnModuleDestroy {
  private interval: NodeJS.Timeout | undefined;
  private reconciliation: Promise<void> | undefined;
  private readonly requestPublications = new Set<Promise<void>>();
  private shuttingDown = false;

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
    if (this.shuttingDown) return;
    const publication = this.withTimeout(
      (signal) => this.publishOne(deliveryId, signal),
      REQUEST_PUBLISH_TIMEOUT_MS,
    ).catch(() => undefined);
    this.requestPublications.add(publication);
    try {
      await publication;
    } finally {
      this.requestPublications.delete(publication);
    }
  }

  async publishOwed(): Promise<void> {
    if (this.shuttingDown) return;
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

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
    await this.reconciliation?.catch(() => undefined);
    await Promise.allSettled([...this.requestPublications]);
  }

  private async publishOne(deliveryId: string, signal: AbortSignal): Promise<void> {
    if (!await this.markAttempt(deliveryId)) return;
    await this.publishAttempt(deliveryId, signal);
  }

  private async markAttempt(deliveryId: string): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      if (!await this.lockCurrentAuthority(transaction, deliveryId)) return false;
      await transaction.githubWebhookDelivery.update({
        where: { id: deliveryId },
        data: { publishedAt: new Date() },
      });
      return true;
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  private async publishAttempt(deliveryId: string, parentSignal?: AbortSignal): Promise<void> {
    const operation = (signal: AbortSignal) => {
      signal.throwIfAborted();
      return this.prisma.$transaction(async (transaction) => {
        if (!await this.lockCurrentAuthority(transaction, deliveryId)) return;
        signal.throwIfAborted();
        await this.enqueueUntilAborted(deliveryId, signal);
      }, {
        maxWait: RECONCILIATION_PUBLISH_TIMEOUT_MS,
        timeout: PUBLICATION_TRANSACTION_TIMEOUT_MS,
      });
    };
    if (parentSignal !== undefined) {
      await operation(parentSignal);
      return;
    }
    await this.withTimeout(operation, RECONCILIATION_PUBLISH_TIMEOUT_MS);
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
        AND ur.removed_at IS NULL
        AND ur.forgotten_at IS NULL
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

  private async enqueueUntilAborted(deliveryId: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => reject(new Error('Webhook queue publication aborted.'));
      signal.addEventListener('abort', onAbort, { once: true });
      void this.queue.enqueue(deliveryId, signal).then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
    });
  }

  private async withTimeout(operation: (signal: AbortSignal) => Promise<void>, timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    const running = operation(controller.signal);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        running,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Webhook queue publication timed out.'));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (controller.signal.aborted) await running.catch(() => undefined);
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

}
