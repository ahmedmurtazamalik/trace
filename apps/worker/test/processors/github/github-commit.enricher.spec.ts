import { generateKeyPairSync } from 'node:crypto';
import { GithubCommitApiEnricher } from '../../../src/processors/github/github-commit-api.enricher';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const appPrivateKey = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('GitHub commit API enricher', () => {
  it('returns stable contributor and numeric file facts through bounded requests', async () => {
    const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(response({ token: 'installation-token' }))
      .mockResolvedValueOnce(response({
        sha: 'a'.repeat(40),
        commit: {
          author: { date: '2026-08-12T11:59:00.000Z' },
          committer: { date: '2026-08-12T12:00:00.000Z' },
        },
        author: { id: 81, login: 'stable-author', avatar_url: null },
        committer: { id: 82, login: 'stable-committer', avatar_url: 'https://avatars.test/82' },
        stats: { additions: 9, deletions: 2 },
        files: [
          { filename: 'src/new.ts', status: 'added', additions: 5, deletions: 0, previous_filename: null },
          { filename: 'src/old.ts', status: 'removed', additions: 0, deletions: 2 },
        ],
      }));
    const enricher = new GithubCommitApiEnricher({ appId: '123', privateKey: appPrivateKey, request, timeoutMs: 100 });

    const facts = await enricher.commit({
      githubInstallationId: 91n,
      githubRepositoryId: 7_001n,
      owner: 'trace-fixture-org',
      name: 'web',
      sha: 'a'.repeat(40),
    });

    expect(facts).toEqual({
      authoredAt: new Date('2026-08-12T11:59:00.000Z'),
      committedAt: new Date('2026-08-12T12:00:00.000Z'),
      author: { githubUserId: 81n, username: 'stable-author', displayName: null, avatarUrl: null },
      committer: { githubUserId: 82n, username: 'stable-committer', displayName: null, avatarUrl: 'https://avatars.test/82' },
      additions: 9,
      deletions: 2,
      files: [
        { path: 'src/new.ts', status: 'added', additions: 5, deletions: 0, previousPath: null },
        { path: 'src/old.ts', status: 'removed', additions: 0, deletions: 2, previousPath: null },
      ],
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toBe('https://api.github.com/app/installations/91/access_tokens');
    expect(request.mock.calls[1]?.[0]).toBe(`https://api.github.com/repos/trace-fixture-org/web/commits/${'a'.repeat(40)}?per_page=100&page=1`);
    expect(request.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
  });

  it('fails closed when GitHub omits stable or bounded commit facts', async () => {
    const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(response({ token: 'installation-token' }))
      .mockResolvedValueOnce(response({
        sha: 'a'.repeat(40),
        commit: { author: { date: 'invalid' }, committer: { date: '2026-08-12T12:00:00.000Z' } },
        author: { login: 'missing-stable-id' },
        committer: null,
        stats: { additions: -1, deletions: 2 },
        files: [],
      }));
    const enricher = new GithubCommitApiEnricher({ appId: '123', privateKey: appPrivateKey, request });

    await expect(enricher.commit({
      githubInstallationId: 91n,
      githubRepositoryId: 7_001n,
      owner: 'trace-fixture-org',
      name: 'web',
      sha: 'a'.repeat(40),
    })).rejects.toThrow('GitHub commit enrichment failed.');
  });

  it('normalizes omitted top-level GitHub user objects to absent contributors', async () => {
    const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(response({ token: 'installation-token' }))
      .mockResolvedValueOnce(response({
        sha: 'a'.repeat(40),
        commit: {
          author: { date: '2026-08-12T11:59:00.000Z' },
          committer: { date: '2026-08-12T12:00:00.000Z' },
        },
        stats: { additions: 0, deletions: 0 },
        files: [],
      }));

    const facts = await new GithubCommitApiEnricher({ appId: '123', privateKey: appPrivateKey, request }).commit({
      githubInstallationId: 91n,
      githubRepositoryId: 7_001n,
      owner: 'trace-fixture-org',
      name: 'web',
      sha: 'a'.repeat(40),
    });

    expect(facts.author).toBeNull();
    expect(facts.committer).toBeNull();
  });

  it('rejects provider pages beyond the documented 100-file bound', async () => {
    const files = Array.from({ length: 101 }, (_, index) => ({
      filename: `src/file-${index}.ts`, status: 'modified', additions: 1, deletions: 0,
    }));
    const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(response({ token: 'installation-token' }))
      .mockResolvedValueOnce(response({
        sha: 'a'.repeat(40),
        commit: {
          author: { date: '2026-08-12T11:59:00.000Z' },
          committer: { date: '2026-08-12T12:00:00.000Z' },
        },
        author: { id: 1, login: 'author', name: null, avatar_url: null },
        committer: { id: 2, login: 'committer', name: null, avatar_url: null },
        stats: { additions: 101, deletions: 0 },
        files,
      }));
    const enricher = new GithubCommitApiEnricher({ appId: '123', privateKey: appPrivateKey, request });

    await expect(enricher.commit({
      githubInstallationId: 91n,
      githubRepositoryId: 7_001n,
      owner: 'trace-fixture-org',
      name: 'web',
      sha: 'a'.repeat(40),
    })).rejects.toThrow('GitHub commit enrichment failed.');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(['/absolute.ts', '../escape.ts', 'src/../escape.ts', 'src\\windows.ts', 'src//empty.ts'])(
    'rejects non-repository-relative provider path %s',
    async (path) => {
      const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce(response({ token: 'installation-token' }))
        .mockResolvedValueOnce(response({
          sha: 'a'.repeat(40),
          commit: {
            author: { date: '2026-08-12T11:59:00.000Z' },
            committer: { date: '2026-08-12T12:00:00.000Z' },
          },
          author: null,
          committer: null,
          stats: { additions: 1, deletions: 0 },
          files: [{ filename: path, status: 'added', additions: 1, deletions: 0 }],
        }));

      await expect(new GithubCommitApiEnricher({ appId: '123', privateKey: appPrivateKey, request }).commit({
        githubInstallationId: 91n,
        githubRepositoryId: 7_001n,
        owner: 'trace-fixture-org',
        name: 'web',
        sha: 'a'.repeat(40),
      })).rejects.toThrow('GitHub commit enrichment failed.');
    },
  );
});
