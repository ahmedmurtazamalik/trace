import { generateKeyPairSync } from 'node:crypto';
import { FakeGithubAuthorizationAdapter, RealGithubAuthorizationAdapter, UnavailableGithubAuthorizationAdapter } from '../src';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const appPrivateKey = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('GitHub authorization adapters', () => {
  it('keeps account identity and installation authorization as separate operations', async () => {
    const adapter = new FakeGithubAuthorizationAdapter();
    const authorization = await adapter.authorize('fake-success-code');
    expect(authorization.user).toMatchObject({ id: 583231n, username: 'fake-octocat' });
    await expect(adapter.installation(91n)).resolves.toEqual({
      id: 91n,
      accountType: 'ORGANIZATION',
      accountLogin: 'trace-fixture-org',
      suspended: false,
    });
    const installUrl = new URL(adapter.installationUrl({ state: 'install-state', appSlug: 'trace-app' }));
    expect(installUrl.pathname).toBe('/apps/trace-app/installations/new');
    expect(installUrl.searchParams.get('state')).toBe('install-state');

    await expect(adapter.repositories(91n)).resolves.toEqual([
      {
        id: 7_001n,
        owner: 'trace-fixture-org',
        name: 'web',
        fullName: 'trace-fixture-org/web',
        private: true,
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/trace-fixture-org/web',
      },
      {
        id: 7_002n,
        owner: 'trace-fixture-org',
        name: 'api',
        fullName: 'trace-fixture-org/api',
        private: false,
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/trace-fixture-org/api',
      },
    ]);
  });

  it('verifies an exact installation through the user-scoped grant', async () => {
    const adapter = new FakeGithubAuthorizationAdapter();
    const verified = await adapter.verifyInstallation('fake-installation-verification-code', 91n);
    expect(verified.user.id).toBe(583231n);
    expect(verified.installation.id).toBe(91n);
    await expect(adapter.verifyInstallation('fake-installation-verification-code', 999n)).rejects.toThrow('verification failed');
  });

  it('builds the real authorization URL without exposing secrets', () => {
    const adapter = new RealGithubAuthorizationAdapter({
      clientId: 'client-id', clientSecret: 'client-secret', appId: '123', privateKey: 'invalid-test-key',
    });
    const url = new URL(adapter.authorizationUrl({ state: 'state-value', callbackUrl: 'https://trace.example/api/v1/github/callback' }));
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.toString()).not.toContain('client-secret');
  });

  it('finds an existing personal installation by stable GitHub account id', async () => {
    const adapter = new RealGithubAuthorizationAdapter({
      clientId: 'client-id', clientSecret: 'client-secret', appId: '123', privateKey: appPrivateKey,
    });
    const originalFetch = global.fetch;
    try {
      global.fetch = jest.fn().mockResolvedValueOnce(new Response(JSON.stringify([
        { id: 90, account: { id: 700, login: 'fixture-org', type: 'Organization' }, suspended_at: null },
        { id: 91, account: { id: 583231, login: 'fake-octocat', type: 'User' }, suspended_at: null },
        { id: 92, account: { id: 800, login: 'other-user', type: 'User' }, suspended_at: null },
      ]), { status: 200 })) as typeof fetch;
      const discover = adapter as unknown as { installationForUser: (githubUserId: bigint) => Promise<unknown> };
      await expect(discover.installationForUser(583_231n)).resolves.toEqual({
        id: 91n, accountType: 'USER', accountLogin: 'fake-octocat', suspended: false,
      });
      expect(global.fetch).toHaveBeenCalledWith('https://api.github.com/app/installations?per_page=100&page=1', expect.any(Object));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('bounds GitHub response bytes and projected identity fields', async () => {
    const adapter = new RealGithubAuthorizationAdapter({
      clientId: 'client-id', clientSecret: 'client-secret', appId: '123', privateKey: 'invalid-test-key',
    });
    const originalFetch = global.fetch;
    const cancel = jest.fn();
    try {
      global.fetch = jest.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, login: 'x'.repeat(101) }), { status: 200 })) as typeof fetch;
      await expect(adapter.authorize('code')).rejects.toThrow('GitHub user lookup failed');

      const oversized = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(300_000)); },
        cancel,
      });
      global.fetch = jest.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(oversized, { status: 200 })) as typeof fetch;
      await expect(adapter.authorize('code')).rejects.toThrow('GitHub user lookup failed');
      expect(cancel).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('falls back to the user-scoped installation list when the exact installation is not yet visible', async () => {
    const adapter = new RealGithubAuthorizationAdapter({
      clientId: 'client-id', clientSecret: 'client-secret', appId: '123', privateKey: appPrivateKey,
    });
    const originalFetch = global.fetch;
    try {
      global.fetch = jest.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 583_231, login: 'fake-octocat' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ installations: [{
          id: 91,
          account: { login: 'trace-fixture-org', type: 'Organization' },
          suspended_at: null,
        }] }), { status: 200 })) as typeof fetch;

      await expect(adapter.verifyInstallation('code', 91n)).resolves.toEqual({
        user: { id: 583_231n, username: 'fake-octocat', displayName: null, avatarUrl: null },
        installation: { id: 91n, accountType: 'ORGANIZATION', accountLogin: 'trace-fixture-org', suspended: false },
      });
      expect(global.fetch).toHaveBeenCalledTimes(4);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('cancels every unused early-rejected response, including parallel verification siblings', async () => {
    const adapter = new RealGithubAuthorizationAdapter({
      clientId: 'client-id', clientSecret: 'client-secret', appId: '123', privateKey: 'invalid-test-key',
    });
    const originalFetch = global.fetch;
    const streaming = (status: number, headers: Record<string, string> = {}): { response: Response; cancel: jest.Mock } => {
      const cancel = jest.fn().mockResolvedValue(undefined);
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('{}')); },
        cancel,
      });
      return { response: new Response(body, { status, headers }), cancel };
    };
    try {
      const failed = streaming(500);
      global.fetch = jest.fn().mockResolvedValueOnce(failed.response) as typeof fetch;
      await expect(adapter.authorize('code')).rejects.toThrow('GitHub token exchange failed');
      expect(failed.cancel).toHaveBeenCalledTimes(1);

      const userFailure = streaming(500);
      global.fetch = jest.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token' }), { status: 200 }))
        .mockResolvedValueOnce(userFailure.response) as typeof fetch;
      await expect(adapter.authorize('code')).rejects.toThrow('GitHub user lookup failed');
      expect(userFailure.cancel).toHaveBeenCalledTimes(1);

      const signedAdapter = new RealGithubAuthorizationAdapter({
        clientId: 'client-id', clientSecret: 'client-secret', appId: '123', privateKey: appPrivateKey,
      });
      const installationFailure = streaming(500);
      global.fetch = jest.fn().mockResolvedValueOnce(installationFailure.response) as typeof fetch;
      await expect(signedAdapter.installation(91n)).rejects.toThrow('GitHub installation lookup failed');
      expect(installationFailure.cancel).toHaveBeenCalledTimes(1);

      const repositoryTokenFailure = streaming(500);
      global.fetch = jest.fn().mockResolvedValueOnce(repositoryTokenFailure.response) as typeof fetch;
      await expect(signedAdapter.repositories(91n)).rejects.toThrow('GitHub repository synchronization failed');
      expect(repositoryTokenFailure.cancel).toHaveBeenCalledTimes(1);

      const repositoryPageFailure = streaming(500);
      global.fetch = jest.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'token' }), { status: 200 }))
        .mockResolvedValueOnce(repositoryPageFailure.response) as typeof fetch;
      await expect(signedAdapter.repositories(91n)).rejects.toThrow('GitHub repository synchronization failed');
      expect(repositoryPageFailure.cancel).toHaveBeenCalledTimes(1);

      const verificationTokenFailure = streaming(500);
      global.fetch = jest.fn().mockResolvedValueOnce(verificationTokenFailure.response) as typeof fetch;
      await expect(adapter.verifyInstallation('code', 91n)).rejects.toThrow('GitHub token exchange failed');
      expect(verificationTokenFailure.cancel).toHaveBeenCalledTimes(1);

      const oversized = streaming(200, { 'content-length': '65537' });
      global.fetch = jest.fn().mockResolvedValueOnce(oversized.response) as typeof fetch;
      await expect(adapter.authorize('code')).rejects.toThrow('GitHub token exchange failed');
      expect(oversized.cancel).toHaveBeenCalledTimes(1);

      const token = new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      const verificationUserFailure = streaming(500);
      const installationSibling = streaming(200);
      global.fetch = jest.fn()
        .mockResolvedValueOnce(token)
        .mockResolvedValueOnce(verificationUserFailure.response)
        .mockResolvedValueOnce(installationSibling.response) as typeof fetch;
      await expect(adapter.verifyInstallation('code', 91n)).rejects.toThrow(
        'GitHub installation verification failed (user_status=500, installation_status=200)',
      );
      expect(verificationUserFailure.cancel).toHaveBeenCalledTimes(1);
      expect(installationSibling.cancel).toHaveBeenCalledTimes(1);

      const fulfilledSibling = streaming(200);
      global.fetch = jest.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token' }), { status: 200 }))
        .mockRejectedValueOnce(new Error('network failure'))
        .mockResolvedValueOnce(fulfilledSibling.response) as typeof fetch;
      await expect(adapter.verifyInstallation('code', 91n)).rejects.toThrow('GitHub installation verification failed');
      expect(fulfilledSibling.cancel).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('fails closed when GitHub authorization is not configured', async () => {
    const adapter = new UnavailableGithubAuthorizationAdapter();
    expect(() => adapter.authorizationUrl({ state: 'state', callbackUrl: 'https://trace.example/callback' })).toThrow('not configured');
    expect(() => adapter.installationUrl({ state: 'state', appSlug: 'trace-app' })).toThrow('not configured');
    await expect(adapter.authorize('code')).rejects.toThrow('not configured');
    await expect(adapter.installation(91n)).rejects.toThrow('not configured');
    await expect(adapter.repositories(91n)).rejects.toThrow('not configured');
    await expect(adapter.verifyInstallation('code', 91n)).rejects.toThrow('not configured');
  });
});
