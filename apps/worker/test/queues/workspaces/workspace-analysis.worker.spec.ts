const mockQueueWaitUntilReady = jest.fn();
const mockQueueClose = jest.fn();
const mockQueueDisconnect = jest.fn();
const mockWorkerWaitUntilReady = jest.fn();
const mockWorkerClose = jest.fn();
const mockWorkerDisconnect = jest.fn();
const mockWorkerRun = jest.fn();
const mockQueueConstructor = jest.fn();
const mockWorkerConstructor = jest.fn();

jest.mock('bullmq', () => ({
  Queue: class {
    constructor(...args: unknown[]) { mockQueueConstructor(...args); }
    waitUntilReady = mockQueueWaitUntilReady;
    close = mockQueueClose;
    disconnect = mockQueueDisconnect;
  },
  Worker: class {
    constructor(...args: unknown[]) { mockWorkerConstructor(...args); }
    waitUntilReady = mockWorkerWaitUntilReady;
    close = mockWorkerClose;
    disconnect = mockWorkerDisconnect;
    run = mockWorkerRun;
  },
  UnrecoverableError: class extends Error {},
}));

import { WorkspaceAnalysisQueueWorker } from '../../../src/queues/workspaces/workspace-analysis.worker';

type Processable = { process(job: unknown): Promise<void> };

describe('WorkspaceAnalysisQueueWorker attempt boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueueWaitUntilReady.mockResolvedValue(undefined);
    mockQueueClose.mockResolvedValue(undefined);
    mockQueueDisconnect.mockResolvedValue(undefined);
    mockWorkerWaitUntilReady.mockResolvedValue(undefined);
    mockWorkerClose.mockResolvedValue(undefined);
    mockWorkerDisconnect.mockResolvedValue(undefined);
    mockWorkerRun.mockResolvedValue(undefined);
  });

  it('closes and disconnects an allocated queue when queue readiness fails', async () => {
    mockQueueWaitUntilReady.mockRejectedValueOnce(new Error('queue readiness failed'));
    const instance = new WorkspaceAnalysisQueueWorker({ redisUrl: 'redis://127.0.0.1:6379/15', processRun: jest.fn() });

    await expect(instance.start()).rejects.toThrow('queue readiness failed');

    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(mockQueueDisconnect).toHaveBeenCalledTimes(1);
    expect(mockWorkerConstructor).not.toHaveBeenCalled();
  });

  it('times out a queue readiness promise that never settles and cleans the queue', async () => {
    jest.useFakeTimers();
    mockQueueWaitUntilReady.mockImplementationOnce(() => new Promise(() => undefined));
    const instance = new WorkspaceAnalysisQueueWorker({
      redisUrl: 'redis://127.0.0.1:6379/15', processRun: jest.fn(), startupTimeoutMs: 100,
    });
    const startup = instance.start().then(() => 'resolved', () => 'rejected');

    await jest.advanceTimersByTimeAsync(100);

    expect(await Promise.race([startup, Promise.resolve('pending')])).toBe('rejected');
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(mockQueueDisconnect).toHaveBeenCalledTimes(1);
    expect(mockWorkerConstructor).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('does not start processing and cleans all resources when worker readiness fails', async () => {
    mockWorkerWaitUntilReady.mockRejectedValueOnce(new Error('worker readiness failed'));
    const instance = new WorkspaceAnalysisQueueWorker({ redisUrl: 'redis://127.0.0.1:6379/15', processRun: jest.fn() });

    await expect(instance.start()).rejects.toThrow('worker readiness failed');

    expect(mockWorkerRun).not.toHaveBeenCalled();
    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    expect(mockWorkerDisconnect).toHaveBeenCalledTimes(1);
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(mockQueueDisconnect).toHaveBeenCalledTimes(1);
  });

  it('times out a worker readiness promise that never settles and cleans every allocated resource', async () => {
    jest.useFakeTimers();
    mockWorkerWaitUntilReady.mockImplementationOnce(() => new Promise(() => undefined));
    const instance = new WorkspaceAnalysisQueueWorker({
      redisUrl: 'redis://127.0.0.1:6379/15', processRun: jest.fn(), startupTimeoutMs: 100,
    });
    const startup = instance.start().then(() => 'resolved', () => 'rejected');

    await jest.advanceTimersByTimeAsync(100);

    expect(await startup).toBe('rejected');
    expect(mockWorkerRun).not.toHaveBeenCalled();
    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    expect(mockWorkerDisconnect).toHaveBeenCalledTimes(1);
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(mockQueueDisconnect).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('marks only the final configured BullMQ attempt as terminal', async () => {
    const processRun = jest.fn().mockResolvedValue(undefined);
    const worker = new WorkspaceAnalysisQueueWorker({ redisUrl: 'redis://127.0.0.1:6379/15', processRun });
    const process = (worker as unknown as Processable).process.bind(worker as unknown as Processable);
    const job = (attemptsMade: number) => ({
      name: 'run-workspace-analysis', data: { runId: 'run_valid-1' }, opts: { attempts: 3 }, attemptsMade,
    });

    await process(job(0));
    await process(job(1));
    await process(job(2));

    expect(processRun.mock.calls).toEqual([
      ['run_valid-1', false],
      ['run_valid-1', false],
      ['run_valid-1', true],
    ]);
  });

  it('forces BullMQ resources closed and disconnected when graceful shutdown fails', async () => {
    const instance = new WorkspaceAnalysisQueueWorker({ redisUrl: 'redis://127.0.0.1:6379/15', processRun: jest.fn() });
    const worker = { close: jest.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValue(undefined), disconnect: jest.fn() };
    const queue = { close: jest.fn().mockResolvedValue(undefined), disconnect: jest.fn() };
    Object.assign(instance as object, { worker, queue, running: Promise.resolve() });

    await expect(instance.close(Date.now() + 1_000)).rejects.toThrow('Workspace analysis worker shutdown failed.');
    expect(worker.close).toHaveBeenLastCalledWith(true);
    expect(worker.disconnect).toHaveBeenCalledTimes(1);
    expect(queue.disconnect).toHaveBeenCalledTimes(1);
  });
});
