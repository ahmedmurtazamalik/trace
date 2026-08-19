import type { TraceConfig } from '@trace/config';

const mockClose = jest.fn<Promise<void>, []>();
const mockDisconnect = jest.fn<Promise<void>, []>();
const mockGetJob = jest.fn();
const mockAdd = jest.fn();
interface CapturedQueueOptions {
  connection: { maxRetriesPerRequest: number; retryStrategy?: (attempts: number) => number | null };
}
let capturedOptions: CapturedQueueOptions | undefined;
const mockQueueConstructor = jest.fn().mockImplementation((_name: string, options: CapturedQueueOptions) => {
  capturedOptions = options;
  return { add: mockAdd, close: mockClose, disconnect: mockDisconnect, getJob: mockGetJob };
});

jest.mock('bullmq', () => ({ Queue: mockQueueConstructor }));

import { WorkspaceAnalysisQueue } from '../src/modules/workspaces/workspace-analysis.queue';

describe('workspace analysis queue producer recovery', () => {
  beforeEach(() => {
    mockAdd.mockReset().mockResolvedValue(undefined);
    mockClose.mockReset().mockResolvedValue(undefined);
    mockDisconnect.mockReset().mockResolvedValue(undefined);
    mockQueueConstructor.mockClear();
    mockGetJob.mockReset().mockResolvedValue(undefined);
    capturedOptions = undefined;
  });

  it('keeps reconnecting after a sustained Redis outage with bounded delay', async () => {
    const queue = new WorkspaceAnalysisQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);
    const retry = capturedOptions?.connection.retryStrategy;
    expect(retry).toBeDefined();
    expect(retry?.(1)).toBeGreaterThan(0);
    expect(retry?.(100)).toBeLessThanOrEqual(1_000);
    await queue.onModuleDestroy();
  });

  it('bounds pending publications and waits for admitted work during shutdown', async () => {
    const pending: Array<(value: undefined) => void> = [];
    mockGetJob.mockImplementation(() => new Promise<undefined>((resolve) => pending.push(resolve)));
    const queue = new WorkspaceAnalysisQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);
    const admitted = Array.from({ length: 100 }, (_, index) => queue.enqueue(`run-${index}`).catch((error: unknown) => error));
    await expect(queue.enqueue('overflow')).rejects.toThrow('capacity');

    let destroyed = false;
    const destruction = queue.onModuleDestroy().then(() => { destroyed = true; });
    await Promise.resolve();
    expect(destroyed).toBe(false);
    for (const resolve of pending) resolve(undefined);
    await destruction;
    expect((await Promise.all(admitted)).every((value) => value instanceof Error)).toBe(true);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('fences admission once shutdown starts', async () => {
    let finishClose: (() => void) | undefined;
    mockClose.mockImplementation(() => new Promise<void>((resolve) => { finishClose = resolve; }));
    const queue = new WorkspaceAnalysisQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);
    const destruction = queue.onModuleDestroy();
    await expect(queue.enqueue('late')).rejects.toThrow('shutting down');
    finishClose?.();
    await destruction;
  });

  it('retries failed deterministic jobs and replaces completed jobs', async () => {
    const retry = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const getState = jest.fn().mockResolvedValueOnce('failed').mockResolvedValueOnce('completed');
    mockGetJob
      .mockResolvedValueOnce({ getState, retry, remove })
      .mockResolvedValueOnce({ getState, retry, remove });
    const queue = new WorkspaceAnalysisQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);
    await queue.enqueue('same-run');
    await queue.enqueue('same-run');
    expect(retry).toHaveBeenCalledWith('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith('run-workspace-analysis', { runId: 'same-run' }, { jobId: 'workspace-analysis-same-run' });
    await queue.onModuleDestroy();
  });

  it('force-disconnects and settles an admitted publication during outage shutdown', async () => {
    jest.useFakeTimers();
    try {
      let rejectGetJob: ((reason: Error) => void) | undefined;
      mockGetJob.mockImplementation(() => new Promise<undefined>((_resolve, reject) => { rejectGetJob = reject; }));
      mockDisconnect.mockImplementation(() => {
        rejectGetJob?.(new Error('connection closed'));
        return Promise.resolve();
      });
      const queue = new WorkspaceAnalysisQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);
      const publication = queue.enqueue('outage').catch((error: unknown) => error);
      const destruction = queue.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(1_500);
      await destruction;
      await expect(publication).resolves.toBeInstanceOf(Error);
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
