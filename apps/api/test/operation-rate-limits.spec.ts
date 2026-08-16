import type { AuthenticatedSession } from '../src/modules/auth/auth.types';
import type { AuthRateLimitService } from '../src/modules/auth/auth-rate-limit.service';
import { ReportsController } from '../src/modules/reports/reports.controller';
import type { ReportsService } from '../src/modules/reports/reports.service';
import { RepositoriesController } from '../src/modules/repositories/repositories.controller';
import type { RepositoriesService } from '../src/modules/repositories/repositories.service';
import type { Request } from 'express';

const session = { user: { id: 'user-1' } } as AuthenticatedSession;
const request = { socket: { remoteAddress: '203.0.113.9' } } as Request;

describe('expensive authenticated operation rate limits', () => {
  it('composes per-user, direct-address, and deployment report budgets before service work', async () => {
    const reports = {
      create: jest.fn().mockResolvedValue({}),
      updateRevision: jest.fn().mockResolvedValue({}),
      regenerate: jest.fn().mockResolvedValue({}),
    } as unknown as ReportsService;
    const consume = jest.fn().mockResolvedValue(undefined);
    const rateLimits = { consume } as unknown as AuthRateLimitService;
    const controller = new ReportsController(reports, rateLimits);

    await controller.create(session, request, {});
    await controller.updateRevision(session, request, 'report-1', {});
    await controller.regenerate(session, request, 'report-1', {});

    expect(consume).toHaveBeenNthCalledWith(1, 'report-create', 'user-1', 20, 3_600_000);
    expect(consume).toHaveBeenNthCalledWith(2, 'report-create:address', '203.0.113.9', 100, 3_600_000);
    expect(consume).toHaveBeenNthCalledWith(3, 'report-create:deployment', 'all', 1_000, 3_600_000);
    expect(consume).toHaveBeenNthCalledWith(4, 'report-revision', 'user-1', 60, 3_600_000);
    expect(consume).toHaveBeenNthCalledWith(5, 'report-revision:address', '203.0.113.9', 300, 3_600_000);
    expect(consume).toHaveBeenNthCalledWith(6, 'report-revision:deployment', 'all', 3_000, 3_600_000);
    expect(consume).toHaveBeenNthCalledWith(7, 'report-regenerate', 'user-1', 20, 3_600_000);
    expect(consume).toHaveBeenNthCalledWith(8, 'report-regenerate:address', '203.0.113.9', 100, 3_600_000);
    expect(consume).toHaveBeenNthCalledWith(9, 'report-regenerate:deployment', 'all', 1_000, 3_600_000);
  });

  it('composes per-user, direct-address, and deployment repository synchronization budgets', async () => {
    const repositories = { synchronize: jest.fn().mockResolvedValue({ accessibleRepositoryCount: 0 }) } as unknown as RepositoriesService;
    const consume = jest.fn().mockResolvedValue(undefined);
    const rateLimits = { consume } as unknown as AuthRateLimitService;
    const controller = new RepositoriesController(repositories, rateLimits);

    await controller.synchronize(session, request);

    expect(consume).toHaveBeenNthCalledWith(1, 'repository-sync', 'user-1', 30, 3_600_000);
    expect(consume).toHaveBeenNthCalledWith(2, 'repository-sync:address', '203.0.113.9', 150, 3_600_000);
    expect(consume).toHaveBeenNthCalledWith(3, 'repository-sync:deployment', 'all', 1_500, 3_600_000);
  });
});
