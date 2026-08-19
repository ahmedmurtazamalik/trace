import { safeWorkerStartupError } from '../src/startup-error';

describe('safeWorkerStartupError', () => {
  it('keeps allowlisted configuration categories', () => {
    expect(safeWorkerStartupError(new Error('Invalid worker configuration: REDIS_URL is required.')))
      .toBe('Invalid worker configuration: REDIS_URL is required.');
  });

  it('redacts arbitrary provider, database, and credential-bearing errors', () => {
    expect(safeWorkerStartupError(new Error('connection failed for postgresql://user:secret@example.test/db')))
      .toBe('Trace workers failed to start.');
  });
});
