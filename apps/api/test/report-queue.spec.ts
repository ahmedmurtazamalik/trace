import type { TraceConfig } from '@trace/config';

const mockClose = jest.fn().mockResolvedValue(undefined);
const mockGetJob = jest.fn();
interface CapturedQueueOptions {
  connection: { maxRetriesPerRequest: number; retryStrategy: (attempts: number) => number | null };
}
let capturedOptions: CapturedQueueOptions | undefined;
const mockQueueConstructor = jest.fn().mockImplementation((_name: string, options: CapturedQueueOptions) => {
  capturedOptions = options;
  return { close: mockClose, getJob: mockGetJob };
});

jest.mock('bullmq', () => ({ Queue: mockQueueConstructor }));

import { ReportQueue } from '../src/modules/reports/report.queue';

describe('report queue producer recovery', () => {
  beforeEach(() => {
    mockClose.mockClear();
    mockQueueConstructor.mockClear();
    mockGetJob.mockReset();
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

  it('admits only one underlying command while Redis initialization is pending', async () => {
    mockGetJob.mockImplementation(() => new Promise(() => undefined));
    const queue = new ReportQueue({ redisUrl: 'redis://127.0.0.1:6379' } as TraceConfig);

    void queue.enqueue('first');
    const followers = Array.from({ length: 100 }, (_, index) =>
      queue.enqueue(`follower-${index}`).catch((error: unknown) => error));
    await Promise.resolve();

    expect(mockGetJob).toHaveBeenCalledTimes(1);
    const outcomes = await Promise.all(followers);
    expect(outcomes).toHaveLength(100);
    expect(outcomes.every((outcome) => outcome instanceof Error)).toBe(true);
    await queue.onModuleDestroy();
  });
});
