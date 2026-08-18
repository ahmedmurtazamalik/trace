import type { TraceConfig } from '@trace/config';

const mockClose = jest.fn().mockResolvedValue(undefined);
interface CapturedQueueOptions {
  connection: { maxRetriesPerRequest: number; retryStrategy: (attempts: number) => number | null };
}
let capturedOptions: CapturedQueueOptions | undefined;
const mockQueueConstructor = jest.fn().mockImplementation((_name: string, options: CapturedQueueOptions) => {
  capturedOptions = options;
  return { close: mockClose };
});

jest.mock('bullmq', () => ({ Queue: mockQueueConstructor }));

import { ReportQueue } from '../src/modules/reports/report.queue';

describe('report queue producer recovery', () => {
  beforeEach(() => {
    mockClose.mockClear();
    mockQueueConstructor.mockClear();
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
});
