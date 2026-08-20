import type { Request, Response } from 'express';
import { WorkspacesController } from '../src/modules/workspaces/workspaces.controller';

const session = { user: { id: 'user-1' }, session: { id: 'session-1' } } as never;
const request = { socket: { remoteAddress: '203.0.113.7' } } as Request;
const response = { status: jest.fn() } as unknown as Response;

describe('WorkspacesController paid-work limits', () => {
  const workspaces = {} as never;
  const analysis = { start: jest.fn().mockResolvedValue({}) };
  const reports = {
    generate: jest.fn().mockResolvedValue({ created: true, response: {} }),
    updateRevision: jest.fn().mockResolvedValue({}),
    regenerate: jest.fn().mockResolvedValue({}),
  };
  const rateLimits = { consume: jest.fn().mockResolvedValue(undefined) };
  const controller = new WorkspacesController(workspaces, analysis as never, reports as never, rateLimits as never);

  beforeEach(() => jest.clearAllMocks());

  it('bounds manual report generation by user, address, and deployment before creating work', async () => {
    await controller.generateReport(session, 'workspace-1', { 'idempotency-key': 'manual-key-123' }, {}, response, request);

    expect(rateLimits.consume.mock.calls).toEqual([
      ['workspace-report-create', 'user-1', 20, 3_600_000],
      ['workspace-report-create:address', '203.0.113.7', 100, 3_600_000],
      ['workspace-report-create:deployment', 'all', 1_000, 3_600_000],
    ]);
    expect(reports.generate).toHaveBeenCalledTimes(1);
  });

  it('bounds workspace report edits before revision/render work', async () => {
    await controller.updateReportRevision(session, request, 'workspace-1', 'report-1', {});

    expect(rateLimits.consume.mock.calls).toEqual([
      ['workspace-report-revision', 'user-1', 60, 3_600_000],
      ['workspace-report-revision:address', '203.0.113.7', 300, 3_600_000],
      ['workspace-report-revision:deployment', 'all', 3_000, 3_600_000],
    ]);
    expect(reports.updateRevision).toHaveBeenCalledTimes(1);
  });

  it('bounds workspace report regeneration before render work and rejects before service work', async () => {
    await controller.regenerateReport(session, request, 'workspace-1', 'report-1', {});

    expect(rateLimits.consume.mock.calls).toEqual([
      ['workspace-report-regenerate', 'user-1', 20, 3_600_000],
      ['workspace-report-regenerate:address', '203.0.113.7', 100, 3_600_000],
      ['workspace-report-regenerate:deployment', 'all', 1_000, 3_600_000],
    ]);
    expect(reports.regenerate).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    rateLimits.consume.mockRejectedValueOnce(new Error('limited'));
    await expect(controller.regenerateReport(session, request, 'workspace-1', 'report-1', {})).rejects.toThrow('limited');
    expect(reports.regenerate).not.toHaveBeenCalled();
  });


  it('bounds baseline collection more tightly before starting GitHub work', async () => {
    await controller.startAnalysis(session, 'workspace-1', 'repository-1', request);

    expect(rateLimits.consume.mock.calls).toEqual([
      ['workspace-baseline', 'user-1', 10, 3_600_000],
      ['workspace-baseline:address', '203.0.113.7', 50, 3_600_000],
      ['workspace-baseline:deployment', 'all', 500, 3_600_000],
    ]);
    expect(analysis.start).toHaveBeenCalledTimes(1);
  });

  it('does not start paid work when a limiter rejects', async () => {
    rateLimits.consume.mockRejectedValueOnce(new Error('limited'));

    await expect(controller.startAnalysis(session, 'workspace-1', 'repository-1', request)).rejects.toThrow('limited');
    expect(analysis.start).not.toHaveBeenCalled();
  });
});
