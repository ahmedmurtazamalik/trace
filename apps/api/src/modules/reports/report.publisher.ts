import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { ReportQueue } from './report.queue';

const PUBLISH_INTERVAL_MS = 5_000;
const REQUEST_PUBLISH_TIMEOUT_MS = 1_000;
const PUBLISH_BATCH_SIZE = 100;

@Injectable()
export class ReportPublisher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReportPublisher.name);
  private interval: NodeJS.Timeout | undefined;
  private reconciliation: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ReportQueue,
  ) {}

  onApplicationBootstrap(): void {
    void this.publishOwed().catch((error: unknown) => this.logFailure('startup reconciliation', error));
    this.interval = setInterval(
      () => void this.publishOwed().catch((error: unknown) => this.logFailure('interval reconciliation', error)),
      PUBLISH_INTERVAL_MS,
    );
    this.interval.unref();
  }

  async publishOneBounded(reportId: string): Promise<void> {
    await this.withTimeout(this.publishOne(reportId), REQUEST_PUBLISH_TIMEOUT_MS)
      .catch((error: unknown) => this.logFailure(`report ${reportId}`, error));
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

  async onModuleDestroy(): Promise<void> {
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
    await this.reconciliation;
  }

  private async reconcile(): Promise<void> {
    const reports = await this.prisma.report.findMany({
      where: { status: 'pending' },
      orderBy: [{ publishedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: PUBLISH_BATCH_SIZE,
      select: { id: true },
    });
    for (const report of reports) {
      await this.publishOne(report.id).catch((error: unknown) => this.logFailure(`report ${report.id}`, error));
    }
  }

  private async publishOne(reportId: string): Promise<void> {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, status: 'pending' },
      select: { id: true },
    });
    if (report === null) return;
    await this.queue.enqueue(report.id);
    await this.prisma.report.updateMany({
      where: { id: report.id, status: 'pending' },
      data: { publishedAt: new Date() },
    });
  }

  private async withTimeout(operation: Promise<void>, timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Report queue publication timed out.')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private logFailure(operation: string, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown report publication failure.';
    this.logger.error(`Failed ${operation}: ${message}`);
  }
}
