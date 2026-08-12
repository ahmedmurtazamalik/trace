import { FakeGithubAuthorizationAdapter, RealGithubAuthorizationAdapter, UnavailableGithubAuthorizationAdapter } from '../src';

describe('GitHub authorization adapters', () => {
  it('keeps account identity and installation authorization separate in the fake adapter', async () => {
    const adapter = new FakeGithubAuthorizationAdapter({
      installation: { id: 91n, accountType: 'ORGANIZATION', accountLogin: 'trace-fixture-org', suspended: false },
    });
    const authorization = await adapter.authorize('fake-success-code');
    expect(authorization.user).toMatchObject({ id: 583231n, username: 'fake-octocat' });
    expect(authorization.installation).toEqual({
      id: 91n,
      accountType: 'ORGANIZATION',
      accountLogin: 'trace-fixture-org',
      suspended: false,
    });
  });

  it('builds the real authorization URL without exposing secrets', () => {
    const adapter = new RealGithubAuthorizationAdapter({ clientId: 'client-id', clientSecret: 'client-secret' });
    const url = new URL(adapter.authorizationUrl({ state: 'state-value', callbackUrl: 'https://trace.example/api/v1/github/callback' }));
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.toString()).not.toContain('client-secret');
  });

  it('fails closed when GitHub authorization is not configured', async () => {
    const adapter = new UnavailableGithubAuthorizationAdapter();
    expect(() => adapter.authorizationUrl({ state: 'state', callbackUrl: 'https://trace.example/callback' })).toThrow('not configured');
    await expect(adapter.authorize('code')).rejects.toThrow('not configured');
  });
});
