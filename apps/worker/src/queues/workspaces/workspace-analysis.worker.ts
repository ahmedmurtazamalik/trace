import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { beforeWorkerDeadline } from '../../shutdown-budget';

interface AnalysisJob { runId: string }
interface WorkspaceAnalysisQueueWorkerOptions {
  redisUrl: string;
  processRun(runId: string, finalAttempt: boolean): Promise<void>;
  concurrency?: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}
export class WorkspaceAnalysisQueueWorker {
  private worker: Worker<AnalysisJob> | undefined;
  private queue: Queue<AnalysisJob> | undefined;
  private running: Promise<void> | undefined;
  constructor(private readonly options: WorkspaceAnalysisQueueWorkerOptions) {}
  get completion(): Promise<void> { return this.running ?? Promise.reject(new Error('Workspace analysis worker has not started.')); }

  async start(): Promise<void> {
    const connection = { url: this.options.redisUrl, maxRetriesPerRequest: null };
    const startupDeadline = Date.now() + (this.options.startupTimeoutMs ?? 5_000);
    try {
      this.queue = new Queue('workspace-analysis', { connection });
      await beforeWorkerDeadline(
        this.queue.waitUntilReady(),
        startupDeadline,
        'Workspace analysis queue startup timed out.',
      );
      this.worker = new Worker('workspace-analysis', (job) => this.process(job), { connection, concurrency: this.options.concurrency ?? 2, autorun: false });
      await beforeWorkerDeadline(
        this.worker.waitUntilReady(),
        startupDeadline,
        'Workspace analysis worker startup timed out.',
      );
      this.running = this.worker.run();
      void this.running.catch(() => undefined);
    } catch (error) {
      await this.cleanupAllocated(Date.now() + (this.options.shutdownTimeoutMs ?? 10_000));
      throw error;
    }
  }

  private async cleanupAllocated(deadline: number): Promise<void> {
    const worker = this.worker;
    const queue = this.queue;
    const running = this.running;
    this.worker = undefined;
    this.queue = undefined;
    this.running = undefined;
    await Promise.allSettled([
      beforeWorkerDeadline(Promise.resolve().then(() => worker?.close(true)), deadline, 'Workspace analysis startup worker close timed out.'),
      beforeWorkerDeadline(Promise.resolve().then(() => queue?.close()), deadline, 'Workspace analysis startup queue close timed out.'),
      beforeWorkerDeadline(Promise.resolve().then(() => worker?.disconnect()), deadline, 'Workspace analysis startup worker disconnect timed out.'),
      beforeWorkerDeadline(Promise.resolve().then(() => queue?.disconnect()), deadline, 'Workspace analysis startup queue disconnect timed out.'),
      beforeWorkerDeadline(running?.catch(() => undefined) ?? Promise.resolve(), deadline, 'Workspace analysis startup run settlement timed out.'),
    ]);
  }

  async close(deadline = Date.now() + 10_000): Promise<void> {
    const worker = this.worker; const queue = this.queue;
    this.worker = undefined; this.queue = undefined;
    try {
      await beforeWorkerDeadline((async () => {
        await worker?.close(false);
        await queue?.close();
        await this.running?.catch(() => undefined);
      })(), deadline, 'Workspace analysis worker shutdown timed out.');
    } catch {
      await Promise.allSettled([
        beforeWorkerDeadline(Promise.resolve().then(() => worker?.close(true)), deadline, 'Workspace analysis worker forced close timed out.'),
        beforeWorkerDeadline(Promise.resolve().then(() => queue?.close()), deadline, 'Workspace analysis queue close timed out.'),
        beforeWorkerDeadline(Promise.resolve().then(() => worker?.disconnect()), deadline, 'Workspace analysis worker disconnect timed out.'),
        beforeWorkerDeadline(Promise.resolve().then(() => queue?.disconnect()), deadline, 'Workspace analysis queue disconnect timed out.'),
      ]);
      throw new Error('Workspace analysis worker shutdown failed.');
    } finally {
      this.running = undefined;
    }
  }

  private async process(job: Job<AnalysisJob>): Promise<void> {
    const runId = job.data?.runId;
    if (job.name !== 'run-workspace-analysis' || typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw new UnrecoverableError('WORKSPACE_ANALYSIS_JOB_INVALID');
    const attempts = typeof job.opts.attempts === 'number' && job.opts.attempts > 0 ? job.opts.attempts : 1;
    await this.options.processRun(runId, job.attemptsMade + 1 >= attempts);
  }
}
