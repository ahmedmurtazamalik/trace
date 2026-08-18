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
    await expect(Promise.all(admitted)).resolves.toEqual(Array(100).fill(undefined));
    expect(mockAdd).toHaveBeenCalledTimes(100);
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
      mockGetJob.mockImplementation(() => new Promise<undefined>(() => undefined));
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
});
