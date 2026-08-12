export interface GithubAuthorizedUser {
  id: bigint;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface GithubInstallationAccess {
  id: bigint;
  accountType: 'USER' | 'ORGANIZATION';
  accountLogin: string;
  suspended: boolean;
}

export interface GithubAuthorizationResult {
  user: GithubAuthorizedUser;
  installation: GithubInstallationAccess | null;
}

export interface GithubAuthorizationAdapter {
  authorizationUrl(input: { state: string; callbackUrl: string }): string;
  authorize(code: string): Promise<GithubAuthorizationResult>;
}

export class FakeGithubAuthorizationAdapter implements GithubAuthorizationAdapter {
  constructor(private readonly input: { installation?: GithubInstallationAccess } = {}) {}

  authorizationUrl(input: { state: string; callbackUrl: string }): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', 'fake-client-id');
    url.searchParams.set('redirect_uri', input.callbackUrl);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  authorize(code: string): Promise<GithubAuthorizationResult> {
    if (code !== 'fake-success-code' && code !== 'fake-installation-code') {
      return Promise.reject(new Error('GitHub authorization failed'));
    }
    return Promise.resolve({
      user: { id: 583_231n, username: 'fake-octocat', displayName: 'Fake Octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/583231' },
      installation: this.input.installation ?? (code === 'fake-installation-code'
        ? { id: 91n, accountType: 'ORGANIZATION', accountLogin: 'trace-fixture-org', suspended: false }
        : null),
    });
  }
}

export class UnavailableGithubAuthorizationAdapter implements GithubAuthorizationAdapter {
  authorizationUrl(input: { state: string; callbackUrl: string }): string {
    void input;
    throw new Error('GitHub authorization is not configured');
  }

  authorize(code: string): Promise<GithubAuthorizationResult> {
    void code;
    return Promise.reject(new Error('GitHub authorization is not configured'));
  }
}

export class RealGithubAuthorizationAdapter implements GithubAuthorizationAdapter {
  constructor(private readonly input: { clientId: string; clientSecret: string }) {}

  authorizationUrl(input: { state: string; callbackUrl: string }): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', this.input.clientId);
    url.searchParams.set('redirect_uri', input.callbackUrl);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async authorize(code: string): Promise<GithubAuthorizationResult> {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.input.clientId, client_secret: this.input.clientSecret, code }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!tokenResponse.ok) throw new Error('GitHub token exchange failed');
    const tokenData = await tokenResponse.json() as { access_token?: string };
    if (tokenData.access_token === undefined) throw new Error('GitHub token exchange failed');
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenData.access_token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!userResponse.ok) throw new Error('GitHub user lookup failed');
    const user = await userResponse.json() as { id?: number; login?: string; name?: string | null; avatar_url?: string | null };
    if (!Number.isSafeInteger(user.id) || typeof user.login !== 'string') throw new Error('GitHub user lookup failed');
    const installationResponse = await fetch('https://api.github.com/user/installations?per_page=100', {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenData.access_token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(5_000),
    });
    let installation: GithubInstallationAccess | null = null;
    if (installationResponse.ok) {
      const payload = await installationResponse.json() as {
        installations?: Array<{ id?: number; account?: { login?: string; type?: string }; suspended_at?: string | null }>;
      };
      const first = payload.installations?.[0];
      if (first !== undefined && Number.isSafeInteger(first.id) && typeof first.account?.login === 'string') {
        installation = {
          id: BigInt(first.id as number),
          accountType: first.account.type === 'Organization' ? 'ORGANIZATION' : 'USER',
          accountLogin: first.account.login,
          suspended: first.suspended_at != null,
        };
      }
    }
    return {
      user: { id: BigInt(user.id as number), username: user.login, displayName: user.name ?? null, avatarUrl: user.avatar_url ?? null },
      installation,
    };
  }
}
