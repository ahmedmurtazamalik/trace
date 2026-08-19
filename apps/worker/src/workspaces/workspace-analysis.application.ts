import { PrismaClient } from '@trace/database';
import { WorkspaceAnalysisQueueWorker } from '../queues/workspaces/workspace-analysis.worker';
import { workerShutdownDeadline, type WorkerStop } from '../shutdown-budget';
import { WorkspaceAnalysisCollector } from './workspace-analysis.collector';
import { WorkspaceAnalysisProcessor } from './workspace-analysis.processor';

export async function startWorkspaceAnalysisWorker(options: { environment: NodeJS.ProcessEnv; onRuntimeFailure?: () => void }): Promise<WorkerStop> {
  const databaseUrl = options.environment.DATABASE_URL;
  const redisUrl = options.environment.REDIS_URL;
  if (databaseUrl === undefined || !databaseUrl.startsWith('postgresql://') || redisUrl === undefined || !/^rediss?:\/\//.test(redisUrl)) throw new Error('Invalid workspace analysis worker configuration.');
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await prisma.$connect();
  const processor = new WorkspaceAnalysisProcessor(prisma, new WorkspaceAnalysisCollector());
  const worker = new WorkspaceAnalysisQueueWorker({ redisUrl, processRun: (runId, finalAttempt) => processor.process(runId, finalAttempt) });
  try { await worker.start(); }
  catch { await prisma.$disconnect(); throw new Error('Workspace analysis worker startup failed.'); }
  void worker.completion.catch(() => options.onRuntimeFailure?.());
  let stopping: Promise<void> | undefined;
  return async (deadline = workerShutdownDeadline(options.environment)) => {
    stopping ??= (async () => { try { await worker.close(deadline); } finally { await prisma.$disconnect(); } })();
    return stopping;
  };
}
