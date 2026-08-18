import type { TraceConfig } from '@trace/config';

const mockClose = jest.fn<Promise<void>, []>();
const mockDisconnect = jest.fn<Promise<void>, []>();
const mockGetJob = jest.fn();
const mockAdd = jest.fn();
interface CapturedQueueOptions {
  connection: { maxRetriesPerRequest: number; retryStrategy: (attempts: number) => number | null };
}
let capturedOptions: CapturedQueueOptions | undefined;
const mockQueueConstructor = jest.fn().mockImplementation((_name: string, options: CapturedQueueOptions) => {
  capturedOptions = options;
  return { add: mockAdd, close: mockClose, disconnect: mockDisconnect, getJob: mockGetJob };
});

jest.mock('bullmq', () => ({ Queue: mockQueueConstructor }));

import { ReportQueue } from '../src/modules/reports/report.queue';

describe('report queue producer recovery', () => {
  beforeEach(() => {
    mockAdd.mockReset().mockResolvedValue(undefined);
    mockClose.mockReset().mockResolvedValue(undefined);
    mockDisconnect.mockReset().mockResolvedValue(undefined);
    mockQueueConstructor.mockClear();
    mockGetJob.mockReset().mockResolvedValue(undefined);
    capturedOptions = undefined;
  });

  it('keeps reconnecting after a sustained Redis outage while bounding the retry delay', async () => {
    const queue = new ReportQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);
    if (capturedOptions === undefined) throw new Error('Report queue options were not captured.');
    const options = capturedOptions;

    expect(options.connection.maxRetriesPerRequest).toBe(1);
    expect(options.connection.retryStrategy(1)).toBeGreaterThan(0);
    expect(options.connection.retryStrategy(3)).toBeGreaterThan(0);
    expect(options.connection.retryStrategy(100)).toBeGreaterThan(0);
    expect(options.connection.retryStrategy(100)).toBeLessThanOrEqual(1_000);

    await queue.onModuleDestroy();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('bounds pending commands and waits for every admitted publication during shutdown', async () => {
    const pending: Array<(value: undefined) => void> = [];
    mockGetJob.mockImplementation(() => new Promise<undefined>((resolve) => pending.push(resolve)));
    const queue = new ReportQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);

    const admitted = Array.from({ length: 100 }, (_, index) =>
      queue.enqueue(`admitted-${index}`).catch((error: unknown) => error));
    const overflow = queue.enqueue('overflow').catch((error: unknown) => error);
    await Promise.resolve();

    expect(admitted).toHaveLength(100);
    expect(mockGetJob).toHaveBeenCalledTimes(100);
    await expect(overflow).resolves.toBeInstanceOf(Error);

    let destroyed = false;
    const destruction = queue.onModuleDestroy().then(() => { destroyed = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(destroyed).toBe(false);

    for (const resolve of pending) resolve(undefined);
    await destruction;
    const settled = await Promise.all(admitted);
    expect(settled).toHaveLength(100);
    expect(settled.every((value) => value instanceof Error)).toBe(true);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('fences new admission as soon as shutdown starts', async () => {
    let finishClose: (() => void) | undefined;
    mockClose.mockImplementation(() => new Promise<void>((resolve) => { finishClose = resolve; }));
    const queue = new ReportQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);

    const destruction = queue.onModuleDestroy();
    await expect(queue.enqueue('too-late')).rejects.toThrow('shutting down');
    finishClose?.();
    await destruction;
    expect(mockGetJob).not.toHaveBeenCalled();
  });

  it('force-disconnects to settle admitted work when graceful close cannot end an outage', async () => {
    jest.useFakeTimers();
    try {
      let rejectGetJob: ((reason: Error) => void) | undefined;
      mockGetJob.mockImplementation(() => new Promise<undefined>((_resolve, reject) => { rejectGetJob = reject; }));
      mockDisconnect.mockImplementation(() => {
        rejectGetJob?.(new Error('connection closed'));
        return Promise.resolve();
      });
      const queue = new ReportQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);
      const publication = queue.enqueue('during-outage').catch((error: unknown) => error);

      const destruction = queue.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(1_500);
      await destruction;

      await expect(publication).resolves.toBeInstanceOf(Error);
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails shutdown when forced disconnect fails instead of reporting false success', async () => {
    jest.useFakeTimers();
    try {
      mockGetJob.mockImplementation(() => new Promise<undefined>(() => undefined));
      mockDisconnect.mockRejectedValue(new Error('disconnect failed'));
      const queue = new ReportQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);
      const publication = queue.enqueue('disconnect-failure').catch((error: unknown) => error);

      const destruction = queue.onModuleDestroy();
      const rejected = expect(destruction).rejects.toThrow('disconnect failed');
      await jest.advanceTimersByTimeAsync(1_500);
      await rejected;
      await expect(publication).resolves.toBeInstanceOf(Error);
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails boundedly when forced disconnect itself never settles', async () => {
    jest.useFakeTimers();
    try {
      mockGetJob.mockImplementation(() => new Promise<undefined>(() => undefined));
      mockDisconnect.mockImplementation(() => new Promise<void>(() => undefined));
      const queue = new ReportQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);
      const publication = queue.enqueue('disconnect-hang').catch((error: unknown) => error);

      const destruction = queue.onModuleDestroy();
      const rejected = expect(destruction).rejects.toThrow('disconnect did not settle');
      await jest.advanceTimersByTimeAsync(2_500);
      await rejected;
      await expect(publication).resolves.toBeInstanceOf(Error);
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails boundedly and prevents late queue mutation when an operation survives disconnect', async () => {
    jest.useFakeTimers();
    try {
      let finishGetJob: ((value: { getState: jest.Mock; retry: jest.Mock }) => void) | undefined;
      const getState = jest.fn().mockResolvedValue('failed');
      const retry = jest.fn().mockResolvedValue(undefined);
      mockGetJob.mockImplementation(() => new Promise((resolve) => { finishGetJob = resolve; }));
      const queue = new ReportQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);
      const publication = queue.enqueue('survivor').catch((error: unknown) => error);

      const destruction = queue.onModuleDestroy();
      const rejected = expect(destruction).rejects.toThrow('did not settle');
      await jest.advanceTimersByTimeAsync(3_000);
      await rejected;
      await expect(publication).resolves.toBeInstanceOf(Error);

      finishGetJob?.({ getState, retry });
      await Promise.resolve();
      await Promise.resolve();
      expect(getState).not.toHaveBeenCalled();
      expect(retry).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
