import { EventEmitter } from 'node:events';
import { startGithubActivityWorker, startTraceWorkers } from '../src/application';
import type { runGithubWebhookWorker } from '../src/runtime';

class SignalProcess extends EventEmitter {
  exitCode: number | undefined;
}

describe('GitHub activity worker application', () => {
  it('stops all consumers concurrently under one absolute shutdown deadline', async () => {
    const events: string[] = [];
    let releaseActivity: (() => void) | undefined;
    let releaseReports: (() => void) | undefined;
    let releaseAnalysis: (() => void) | undefined;
    const stopActivity = jest.fn<Promise<void>, [number?]>(() => new Promise<void>((resolve) => {
      events.push('activity-stop');
      releaseActivity = resolve;
    }));
    const stopReports = jest.fn<Promise<void>, [number?]>(() => new Promise<void>((resolve) => {
      events.push('reports-stop');
      releaseReports = resolve;
    }));
    const stopAnalysis = jest.fn<Promise<void>, [number?]>(() => new Promise<void>((resolve) => {
      events.push('analysis-stop');
      releaseAnalysis = resolve;
    }));
    const startActivity = jest.fn(() => { events.push('activity-start'); return Promise.resolve(stopActivity); });
    const startReports = jest.fn(() => { events.push('reports-start'); return Promise.resolve(stopReports); });
    const startAnalysis = jest.fn(() => { events.push('analysis-start'); return Promise.resolve(stopAnalysis); });

    const stop = await startTraceWorkers({
      environment: { WORKER_SHUTDOWN_TIMEOUT_MS: '120000' },
      startActivity: startActivity as never,
      startReports: startReports as never,
      startWorkspaceAnalysis: startAnalysis as never,
    });
    const stopping = stop();
    await Promise.resolve();

    expect(events.slice(0, 3).sort()).toEqual(['activity-start', 'analysis-start', 'reports-start']);
    expect(events.slice(3).sort()).toEqual(['activity-stop', 'analysis-stop', 'reports-stop']);
    const activityDeadline = stopActivity.mock.calls[0]?.[0];
    const reportDeadline = stopReports.mock.calls[0]?.[0];
    const analysisDeadline = stopAnalysis.mock.calls[0]?.[0];
    expect(activityDeadline).toBe(reportDeadline);
    expect(activityDeadline).toBe(analysisDeadline);
    expect(activityDeadline).toBeGreaterThan(Date.now());
    releaseActivity?.();
    releaseReports?.();
    releaseAnalysis?.();
    await stopping;
  });

  it('propagates child runtime failure and cleanup failure to the coordinator', async () => {
    const runtimeFailure = jest.fn();
    let childFailure: (() => void) | undefined;
    const startActivity = jest.fn((options: { onRuntimeFailure?: () => void }) => {
      childFailure = options.onRuntimeFailure;
      return Promise.resolve(jest.fn().mockResolvedValue(undefined));
    });
    const startReports = jest.fn(() => Promise.resolve(jest.fn().mockRejectedValue(new Error('cleanup failed'))));
    const startAnalysis = jest.fn(() => Promise.resolve(jest.fn().mockResolvedValue(undefined)));
    const stop = await startTraceWorkers({
      environment: {}, startActivity: startActivity as never, startReports: startReports as never,
      startWorkspaceAnalysis: startAnalysis as never,
      onRuntimeFailure: runtimeFailure,
    });
    childFailure?.();
    expect(runtimeFailure).toHaveBeenCalledTimes(1);
    await expect(stop()).rejects.toThrow('Trace workers cleanup failed.');
  });

  it('reports only the failing startup subsystem after bounded cleanup', async () => {
    const stopActivity = jest.fn().mockResolvedValue(undefined);
    await expect(startTraceWorkers({
      environment: {},
      startActivity: jest.fn().mockResolvedValue(stopActivity) as never,
      startReports: jest.fn().mockRejectedValue(new Error('secret provider detail')) as never,
      startWorkspaceAnalysis: jest.fn() as never,
    })).rejects.toThrow('Trace report worker startup failed.');
    expect(stopActivity).toHaveBeenCalledTimes(1);
  });

  it('validates database and GitHub App configuration before creating resources', async () => {
    await expect(startGithubActivityWorker({
      environment: { REDIS_URL: 'redis://localhost:6379/0' },
    })).rejects.toThrow('Invalid activity worker configuration.');
  });

  it('composes delivery processing and fixed terminal failure persistence', async () => {
    const processDelivery = jest.fn().mockResolvedValue(undefined);
    const updateMany = jest.fn<Promise<unknown>, [{
      where: { id: string; status: { notIn: string[] } };
      data: { status: string; processedAt: Date; processingError: string };
    }]>().mockResolvedValue(undefined);
    const connect = jest.fn().mockResolvedValue(undefined);
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const runWorker = jest.fn<ReturnType<typeof runGithubWebhookWorker>, Parameters<typeof runGithubWebhookWorker>>(async (options) => {
      await options.processDelivery('internal-delivery');
      await options.recordTerminalFailure('internal-delivery', 'WEBHOOK_PROCESSING_FAILED');
      await options.closeResources?.();
      return jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    });
    const signals = new SignalProcess();

    await startGithubActivityWorker({
      environment: {
        DATABASE_URL: 'postgresql://trace:trace@localhost:5432/trace',
        REDIS_URL: 'redis://localhost:6379/0',
        GITHUB_APP_ID: '123',
        GITHUB_APP_PRIVATE_KEY: 'private-key',
      },
      signals: signals as unknown as NodeJS.Process,
      prisma: {
        githubWebhookDelivery: { updateMany },
        $connect: connect,
        $disconnect: disconnect,
      } as never,
      enricher: {} as never,
      processor: { process: processDelivery } as never,
      runWorker,
    });

    expect(processDelivery).toHaveBeenCalledWith('internal-delivery');
    expect(connect).toHaveBeenCalledTimes(1);
    const terminalUpdate = updateMany.mock.calls[0]?.[0];
    expect(terminalUpdate?.data.processedAt).toBeInstanceOf(Date);
    expect(terminalUpdate).toEqual({
      where: { id: 'internal-delivery', status: { notIn: ['completed', 'failed'] } },
      data: {
        status: 'failed',
        processedAt: terminalUpdate?.data.processedAt,
        processingError: 'WEBHOOK_PROCESSING_FAILED',
      },
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('fails startup safely and closes Prisma when PostgreSQL is unavailable', async () => {
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const runWorker = jest.fn();

    await expect(startGithubActivityWorker({
      environment: {
        DATABASE_URL: 'postgresql://trace:***@localhost:5432/trace',
        REDIS_URL: 'redis://localhost:6379/0',
        GITHUB_APP_ID: '123',
        GITHUB_APP_PRIVATE_KEY: 'private-key',
      },
      prisma: {
        $connect: jest.fn().mockRejectedValue(new Error('database secret detail')),
        $disconnect: disconnect,
      } as never,
      enricher: {} as never,
      processor: { process: jest.fn() } as never,
      runWorker: runWorker as never,
    })).rejects.toThrow('GitHub activity worker startup failed.');

    expect(runWorker).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('bounds Prisma cleanup when startup fails', async () => {
    const disconnect = jest.fn(() => new Promise<void>(() => undefined));

    await expect(startGithubActivityWorker({
      environment: {
        DATABASE_URL: 'postgresql://trace:***@localhost:5432/trace',
        REDIS_URL: 'redis://localhost:6379/0',
        GITHUB_APP_ID: '123',
        GITHUB_APP_PRIVATE_KEY: 'private-key',
      },
      prisma: {
        $connect: jest.fn().mockRejectedValue(new Error('database secret detail')),
        $disconnect: disconnect,
      } as never,
      enricher: {} as never,
      processor: { process: jest.fn() } as never,
      resourceCleanupTimeoutMs: 20,
    })).rejects.toThrow('GitHub activity worker startup failed.');

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
