import { createHash } from 'node:crypto';
import { ReportsService } from '../src/modules/reports/reports.service';

describe('workspace report authorization races', () => {
  it('fails closed when membership is removed while artifact bytes are being read', async () => {
    const bytes = Buffer.from('%PDF-1.7\nworkspace\n%%EOF');
    let releaseStorage!: (value: Buffer) => void;
    const storageRead = new Promise<Buffer>((resolve) => { releaseStorage = resolve; });
    const artifact = {
      id: 'artifact-1', reportId: 'report-1', revisionId: 'revision-1', kind: 'pdf',
      storageKey: 'workspaces/workspace-1/reports/report-1/revisions/1/report.pdf',
      sizeBytes: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex'),
      report: { currentRevisionId: 'revision-1' },
    };
    type Lookup = { where?: { id?: string; reportId?: string; revisionId?: string; report?: { workspaceId?: string } } };
    const findFirst = jest.fn<Promise<typeof artifact | null>, [Lookup]>()
      .mockResolvedValueOnce(artifact)
      .mockResolvedValueOnce(null);
    const prisma = { reportArtifact: { findFirst } };
    const storage = { get: jest.fn().mockReturnValue(storageRead) };
    const service = new ReportsService(prisma as never, {} as never, {} as never, storage as never);

    const download = service.downloadWorkspace('developer-1', 'workspace-1', 'report-1', { artifactId: 'artifact-1' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledTimes(1);

    releaseStorage(bytes);

    await expect(download).rejects.toMatchObject({ status: 404, response: { code: 'REPORT_ARTIFACT_NOT_FOUND' } });
    expect(findFirst).toHaveBeenCalledTimes(2);
    const secondLookup = findFirst.mock.calls[1]?.[0];
    expect(secondLookup?.where?.id).toBe('artifact-1');
    expect(secondLookup?.where?.reportId).toBe('report-1');
    expect(secondLookup?.where?.revisionId).toBe('revision-1');
    expect(secondLookup?.where?.report?.workspaceId).toBe('workspace-1');
  });
});
