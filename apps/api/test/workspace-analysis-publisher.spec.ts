import { Logger } from '@nestjs/common';
import { WorkspaceAnalysisPublisher } from '../src/modules/workspaces/workspace-analysis.publisher';

describe('WorkspaceAnalysisPublisher', () => {
  it('contains a failed reconciliation for every overlapping caller', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let rejectTransaction!: (error: Error) => void;
    const transaction = new Promise<never>((_resolve, reject) => {
      rejectTransaction = reject;
    });
    const prisma = {
      $transaction: jest.fn().mockReturnValue(transaction),
      workspaceAnalysisRun: { findMany: jest.fn() },
    };
    const publisher = new WorkspaceAnalysisPublisher(prisma as never, {} as never);

    const first = publisher.publishOwed();
    const overlapping = publisher.publishOwed();
    rejectTransaction(new Error('transaction timed out'));

    await expect(Promise.all([first, overlapping])).resolves.toEqual([undefined, undefined]);
  });
});
