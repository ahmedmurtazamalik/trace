import { EventEmitter } from 'node:events';
import { startGithubActivityWorker } from '../src/application';
import type { runGithubWebhookWorker } from '../src/runtime';

class SignalProcess extends EventEmitter {
  exitCode: number | undefined;
}

describe('GitHub activity worker application', () => {
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
