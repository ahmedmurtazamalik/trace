import { EventEmitter } from 'node:events';
import { reportWorkerConfiguration, startReportWorker } from '../../src/reports/report-application';


class SignalProcess extends EventEmitter { exitCode: number | undefined }

describe('report worker application', () => {
  it('composes Prisma, Codex-capable provider selection, queue processing, and cleanup', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const process = jest.fn().mockResolvedValue(undefined);
    const start = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    const delivery = { attempt: 2, maximumAttempts: 3, finalDelivery: false };
    const workerFactory = jest.fn().mockImplementation((options: {
      processReport(id: string, context: typeof delivery): Promise<void>;
      shutdownTimeoutMs: number;
    }) => ({
      start: async () => { await start(); await options.processReport('report-1', delivery); },
      close,
      completion: new Promise<void>(() => undefined),
    }));

    const stop = await startReportWorker({
      environment: { NODE_ENV: 'test', DATABASE_URL: 'postgresql://trace:***@localhost/trace', REDIS_URL: 'redis://localhost:6379', REPORT_LLM_PROVIDER: 'fake' },
      signals: new SignalProcess() as unknown as NodeJS.Process,
      prisma: { $connect: connect, $disconnect: disconnect } as never,
      processor: { process } as never,
      workerFactory: workerFactory as never,
    });

    expect(process).toHaveBeenCalledWith('report-1', delivery);
    expect(workerFactory).toHaveBeenCalledWith(expect.objectContaining({ shutdownTimeoutMs: 210_000 }));
    const deadline = Date.now() + 1_000;
    await stop(deadline);
    expect(close).toHaveBeenCalledWith(deadline);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('requires an absolute host-shared LaTeX work root when configured', () => {
    const base = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://trace:password@localhost/trace',
      REDIS_URL: 'redis://localhost:6379',
      REPORT_LLM_PROVIDER: 'fake',
      REPORT_LATEX_WORK_ROOT: '/var/lib/trace/latex-work',
    };
    expect(reportWorkerConfiguration(base)).toMatchObject({ latexWorkRoot: '/var/lib/trace/latex-work' });
    expect(() => reportWorkerConfiguration({ ...base, REPORT_LATEX_WORK_ROOT: 'relative/path' }))
      .toThrow('Invalid report worker configuration.');
    expect(() => reportWorkerConfiguration({ ...base, WORKER_SHUTDOWN_TIMEOUT_MS: '9999' }))
      .toThrow('WORKER_SHUTDOWN_TIMEOUT_MS');
    expect(reportWorkerConfiguration({
      ...base,
      NODE_ENV: 'production',
      REPORT_LLM_PROVIDER: 'codex',
      REPORT_LATEX_IMAGE: `sha256:${'a'.repeat(64)}`,
    })).toMatchObject({ latexImage: `sha256:${'a'.repeat(64)}` });
    expect(() => reportWorkerConfiguration({
      ...base,
      NODE_ENV: 'production',
      REPORT_LLM_PROVIDER: 'configured',
      REPORT_LATEX_IMAGE: `sha256:${'a'.repeat(64)}`,
    })).toThrow('Invalid report worker configuration.');
  });

  it('rejects fake provider defaults in production and incomplete settings', async () => {
    await expect(startReportWorker({ environment: {
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://trace:***@localhost/trace', REDIS_URL: 'redis://localhost:6379', REPORT_LLM_PROVIDER: 'fake',
    } })).rejects.toThrow('Invalid report worker configuration.');
    await expect(startReportWorker({ environment: {
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://trace:***@localhost/trace', REDIS_URL: 'redis://localhost:6379',
      REPORT_LLM_PROVIDER: 'openai', REPORT_LATEX_IMAGE: 'trace-latex:latest',
    } })).rejects.toThrow('Invalid report worker configuration.');
    await expect(startReportWorker({ environment: {
      NODE_ENV: 'prod', DATABASE_URL: 'postgresql://trace:***@localhost/trace', REDIS_URL: 'redis://localhost:6379',
      REPORT_LLM_PROVIDER: 'openai', REPORT_LATEX_IMAGE: `trace-latex@sha256:${'a'.repeat(64)}`,
    } })).rejects.toThrow('Invalid report worker configuration.');
    await expect(startReportWorker({ environment: {
      DATABASE_URL: 'postgresql://trace:***@localhost/trace', REDIS_URL: 'redis://localhost:6379', REPORT_LLM_PROVIDER: 'fake',
    } })).rejects.toThrow('Invalid report worker configuration.');
    await expect(startReportWorker({ environment: { NODE_ENV: 'test', DATABASE_URL: 'bad', REDIS_URL: 'bad' } })).rejects.toThrow('Invalid report worker configuration.');
  });
});
