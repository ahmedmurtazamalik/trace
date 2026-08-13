import { EventEmitter } from 'node:events';
import { startReportWorker } from '../../src/reports/report-application';


class SignalProcess extends EventEmitter { exitCode: number | undefined }

describe('report worker application', () => {
  it('composes Prisma, configured provider, queue processing, and cleanup', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const process = jest.fn().mockResolvedValue(undefined);
    const start = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    const workerFactory = jest.fn().mockImplementation((options: { processReport(id: string): Promise<void> }) => ({
      start: async () => { await start(); await options.processReport('report-1'); },
      close,
      completion: new Promise<void>(() => undefined),
    }));

    const stop = await startReportWorker({
      environment: { DATABASE_URL: 'postgresql://trace:***@localhost/trace', REDIS_URL: 'redis://localhost:6379', REPORT_LLM_PROVIDER: 'fake' },
      signals: new SignalProcess() as unknown as NodeJS.Process,
      prisma: { $connect: connect, $disconnect: disconnect } as never,
      processor: { process } as never,
      workerFactory: workerFactory as never,
    });

    expect(process).toHaveBeenCalledWith('report-1');
    await stop();
    expect(close).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects fake provider defaults in production and incomplete settings', async () => {
    await expect(startReportWorker({ environment: {
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://trace:***@localhost/trace', REDIS_URL: 'redis://localhost:6379', REPORT_LLM_PROVIDER: 'fake',
    } })).rejects.toThrow('Invalid report worker configuration.');
    await expect(startReportWorker({ environment: { DATABASE_URL: 'bad', REDIS_URL: 'bad' } })).rejects.toThrow('Invalid report worker configuration.');
  });
});
