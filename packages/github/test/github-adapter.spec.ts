import { FakeGithubAuthorizationAdapter, RealGithubAuthorizationAdapter, UnavailableGithubAuthorizationAdapter } from '../src';

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

  it('fails closed when GitHub authorization is not configured', async () => {
    const adapter = new UnavailableGithubAuthorizationAdapter();
    expect(() => adapter.authorizationUrl({ state: 'state', callbackUrl: 'https://trace.example/callback' })).toThrow('not configured');
    expect(() => adapter.installationUrl({ state: 'state', appSlug: 'trace-app' })).toThrow('not configured');
    await expect(adapter.authorize('code')).rejects.toThrow('not configured');
    await expect(adapter.installation(91n)).rejects.toThrow('not configured');
    await expect(adapter.verifyInstallation('code', 91n)).rejects.toThrow('not configured');
  });
});
