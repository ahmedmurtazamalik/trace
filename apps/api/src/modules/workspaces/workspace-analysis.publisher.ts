import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@trace/database';
import { WorkspaceAnalysisQueue } from './workspace-analysis.queue';

@Injectable()
export class WorkspaceAnalysisPublisher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceAnalysisPublisher.name);
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;
  constructor(private readonly prisma: PrismaService, private readonly queue: WorkspaceAnalysisQueue) {}

  onApplicationBootstrap(): void {
    void this.publishOwed();
    this.timer = setInterval(() => void this.publishOwed(), 5_000);
    this.timer.unref();
  }

  async publishOne(runId: string): Promise<void> {
    const updated = await this.prisma.workspaceAnalysisRun.updateMany({ where: { id: runId, status: 'PENDING' }, data: { publishedAt: new Date() } });
    if (updated.count === 0) return;
    try { await this.queue.enqueue(runId); }
    catch { this.logger.error('Workspace analysis publication failed; reconciliation will retry.'); }
  }

  async publishOwed(): Promise<void> {
    if (this.active === undefined) {
      const reconciliation = (async () => {
        await this.recoverExpired();
        const rows = await this.prisma.workspaceAnalysisRun.findMany({ where: { status: 'PENDING' }, orderBy: [{ publishedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }], take: 100, select: { id: true } });
        for (const row of rows) await this.publishOne(row.id);
      })();
      const guarded = reconciliation
        .catch(() => { this.logger.error('Workspace analysis reconciliation failed.'); })
        .finally(() => { if (this.active === guarded) this.active = undefined; });
      this.active = guarded;
    }
    await this.active;
  }

  private async recoverExpired(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const expired = await tx.workspaceAnalysisRun.findMany({
        where: { status: 'PROCESSING', processingExpiresAt: { lte: new Date() } },
        orderBy: { processingExpiresAt: 'asc' },
        take: 100,
        select: { id: true, analysisId: true },
      });
      if (expired.length === 0) return;
      await tx.workspaceAnalysisRun.updateMany({
        where: { id: { in: expired.map((run) => run.id) }, status: 'PROCESSING', processingExpiresAt: { lte: new Date() } },
        data: { status: 'PENDING', publishedAt: null, processingToken: null, processingExpiresAt: null },
      });
      for (const analysisId of new Set(expired.map((run) => run.analysisId))) {
        await tx.workspaceRepositoryAnalysis.updateMany({
          where: { id: analysisId, status: 'PROCESSING', runs: { none: { status: 'PROCESSING' } } },
          data: { status: 'PENDING' },
        });
      }
    });
  }

  async onModuleDestroy(): Promise<void> { if (this.timer !== undefined) clearInterval(this.timer); await this.active; }
}
