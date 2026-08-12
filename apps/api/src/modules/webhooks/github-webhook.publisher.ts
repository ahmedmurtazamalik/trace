import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { GithubWebhookQueue } from './github-webhook.queue';

const PUBLISH_INTERVAL_MS = 5_000;
const REQUEST_PUBLISH_TIMEOUT_MS = 1_000;
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
      where: { status: 'pending', publishedAt: null },
      orderBy: { receivedAt: 'asc' },
      take: PUBLISH_BATCH_SIZE,
      select: { id: true },
    });
    for (const delivery of deliveries) {
      await this.publishOne(delivery.id).catch(() => undefined);
    }
  }

  onModuleDestroy(): void {
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
  }

  private async publishOne(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.githubWebhookDelivery.findFirst({
      where: { id: deliveryId, status: 'pending', publishedAt: null },
      select: { id: true },
    });
    if (delivery === null) return;
    await this.queue.enqueue(delivery.id);
    await this.prisma.githubWebhookDelivery.updateMany({
      where: { id: delivery.id, status: 'pending', publishedAt: null },
      data: { publishedAt: new Date() },
    });
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
