import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { ReportQueueWorker } from '../../../src/queues/reports/report.worker';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379/0';

describe('report queue worker', () => {
  let queue: Queue<{ reportId: string }>;
  let queueName: string;
  let worker: ReportQueueWorker | undefined;

  beforeEach(() => {
    queueName = `report-worker-test-${process.pid}-${randomUUID()}`;
    queue = new Queue(queueName, { connection: { url: redisUrl } });
  });
  afterEach(async () => {
    await worker?.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('processes only the frozen report job reference and drains cleanly', async () => {
    const processReport = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    worker = new ReportQueueWorker({ redisUrl, queueName, processReport });
    await worker.start();

    await queue.add('generate-report', { reportId: 'report-row-1' }, { jobId: 'report-report-row-1' });
    await worker.waitUntilIdle();

    expect(processReport).toHaveBeenCalledTimes(1);
    expect(processReport).toHaveBeenCalledWith('report-row-1');
    await expect(worker.close()).resolves.toBeUndefined();
  });

  it('rejects malformed job names and references without invoking the processor', async () => {
    const processReport = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    worker = new ReportQueueWorker({ redisUrl, queueName, processReport });
    await worker.start();

    await queue.add('wrong-name', { reportId: 'report-row-1' }, { jobId: 'wrong-report-row-1' });
    await queue.add('generate-report', { reportId: '../secret' }, { jobId: 'bad-report-row-1' });
    await worker.waitUntilIdle();

    expect(processReport).not.toHaveBeenCalled();
    expect((await queue.getJob('wrong-report-row-1'))?.failedReason).toBe('REPORT_JOB_INVALID');
    expect((await queue.getJob('bad-report-row-1'))?.failedReason).toBe('REPORT_JOB_INVALID');
  });

  it('closes malformed non-object job data with the fixed error', async () => {
    const processReport = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    worker = new ReportQueueWorker({ redisUrl, queueName, processReport });
    await worker.start();
    await (queue as unknown as Queue<unknown>).add('generate-report', null, { jobId: 'null-report-row' });
    await worker.waitUntilIdle();
    expect((await queue.getJob('null-report-row'))?.failedReason).toBe('REPORT_JOB_INVALID');
    expect(processReport).not.toHaveBeenCalled();
    expect((await queue.getJob('null-report-row'))?.attemptsMade).toBe(1);
  });

  it('sanitizes unexpected processor failures before BullMQ retains them', async () => {
    worker = new ReportQueueWorker({
      redisUrl, queueName,
      processReport: jest.fn().mockRejectedValue(new Error('SECRET_PROCESSOR_FRAGMENT')),
    });
    await worker.start();
    await queue.add('generate-report', { reportId: 'safe-report-id' }, { jobId: 'sanitized-report-row', attempts: 1 });
    await worker.waitUntilIdle();
    const job = await queue.getJob('sanitized-report-row');
    expect(job?.failedReason).toBe('REPORT_PROCESSING_RETRY');
    expect(job?.stacktrace?.join('\n') ?? '').not.toContain('SECRET_PROCESSOR_FRAGMENT');
  });
});
