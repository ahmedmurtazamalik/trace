import { createSign } from 'node:crypto';

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

export interface GithubRepositoryAccess {
  id: bigint;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string | null;
}

export interface GithubAuthorizationResult {
  user: GithubAuthorizedUser;
}

export interface GithubAuthorizationAdapter {
  authorizationUrl(input: { state: string; callbackUrl: string }): string;
  authorize(code: string): Promise<GithubAuthorizationResult>;
  installationUrl(input: { state: string; appSlug: string }): string;
  installation(installationId: bigint): Promise<GithubInstallationAccess>;
  repositories(installationId: bigint): Promise<GithubRepositoryAccess[]>;
  verifyInstallation(code: string, installationId: bigint): Promise<{ user: GithubAuthorizedUser; installation: GithubInstallationAccess }>;
}

export class FakeGithubAuthorizationAdapter implements GithubAuthorizationAdapter {
  authorizationUrl(input: { state: string; callbackUrl: string }): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', 'fake-client-id');
    url.searchParams.set('redirect_uri', input.callbackUrl);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  authorize(code: string): Promise<GithubAuthorizationResult> {
    if (code !== 'fake-success-code') return Promise.reject(new Error('GitHub authorization failed'));
    return Promise.resolve({
      user: { id: 583_231n, username: 'fake-octocat', displayName: 'Fake Octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/583231' },
    });
  }

  installationUrl(input: { state: string; appSlug: string }): string {
    const url = new URL(`https://github.com/apps/${input.appSlug}/installations/new`);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  installation(installationId: bigint): Promise<GithubInstallationAccess> {
    return Promise.resolve({ id: installationId, accountType: 'ORGANIZATION', accountLogin: 'trace-fixture-org', suspended: false });
  }

  repositories(installationId: bigint): Promise<GithubRepositoryAccess[]> {
    if (installationId !== 91n) return Promise.reject(new Error('GitHub repository synchronization failed'));
    return Promise.resolve([
      { id: 7_001n, owner: 'trace-fixture-org', name: 'web', fullName: 'trace-fixture-org/web', private: true, defaultBranch: 'main', htmlUrl: 'https://github.com/trace-fixture-org/web' },
      { id: 7_002n, owner: 'trace-fixture-org', name: 'api', fullName: 'trace-fixture-org/api', private: false, defaultBranch: 'main', htmlUrl: 'https://github.com/trace-fixture-org/api' },
    ]);
  }

  verifyInstallation(code: string, installationId: bigint): Promise<{ user: GithubAuthorizedUser; installation: GithubInstallationAccess }> {
    if (code !== 'fake-installation-verification-code' || installationId !== 91n) return Promise.reject(new Error('GitHub installation verification failed'));
    return Promise.resolve({
      user: { id: 583_231n, username: 'fake-octocat', displayName: 'Fake Octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/583231' },
      installation: { id: installationId, accountType: 'ORGANIZATION', accountLogin: 'trace-fixture-org', suspended: false },
    });
  }
}

export class UnavailableGithubAuthorizationAdapter implements GithubAuthorizationAdapter {
  authorizationUrl(input: { state: string; callbackUrl: string }): string { void input; throw new Error('GitHub authorization is not configured'); }
  authorize(code: string): Promise<GithubAuthorizationResult> { void code; return Promise.reject(new Error('GitHub authorization is not configured')); }
  installationUrl(input: { state: string; appSlug: string }): string { void input; throw new Error('GitHub installation is not configured'); }
  installation(installationId: bigint): Promise<GithubInstallationAccess> { void installationId; return Promise.reject(new Error('GitHub installation is not configured')); }
  repositories(installationId: bigint): Promise<GithubRepositoryAccess[]> { void installationId; return Promise.reject(new Error('GitHub installation is not configured')); }
  verifyInstallation(code: string, installationId: bigint): Promise<{ user: GithubAuthorizedUser; installation: GithubInstallationAccess }> { void code; void installationId; return Promise.reject(new Error('GitHub installation is not configured')); }
}

export class RealGithubAuthorizationAdapter implements GithubAuthorizationAdapter {
  constructor(private readonly input: { clientId: string; clientSecret: string; appId: string; privateKey: string }) {}

  authorizationUrl(input: { state: string; callbackUrl: string }): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', this.input.clientId);
    url.searchParams.set('redirect_uri', input.callbackUrl);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  installationUrl(input: { state: string; appSlug: string }): string {
    const url = new URL(`https://github.com/apps/${input.appSlug}/installations/new`);
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
    return { user: { id: BigInt(user.id as number), username: user.login, displayName: user.name ?? null, avatarUrl: user.avatar_url ?? null } };
  }

  async installation(installationId: bigint): Promise<GithubInstallationAccess> {
    const response = await fetch(`https://api.github.com/app/installations/${installationId.toString()}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.appJwt()}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error('GitHub installation lookup failed');
    const value = await response.json() as { id?: number; account?: { login?: string; type?: string }; suspended_at?: string | null };
    if (!Number.isSafeInteger(value.id) || BigInt(value.id as number) !== installationId || typeof value.account?.login !== 'string') {
      throw new Error('GitHub installation lookup failed');
    }
    return {
      id: installationId,
      accountType: value.account.type === 'Organization' ? 'ORGANIZATION' : 'USER',
      accountLogin: value.account.login,
      suspended: value.suspended_at != null,
    };
  }

  async repositories(installationId: bigint): Promise<GithubRepositoryAccess[]> {
    const tokenResponse = await fetch(`https://api.github.com/app/installations/${installationId.toString()}/access_tokens`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.appJwt()}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!tokenResponse.ok) throw new Error('GitHub repository synchronization failed');
    const tokenData = await tokenResponse.json() as { token?: string };
    if (typeof tokenData.token !== 'string' || tokenData.token.length === 0) throw new Error('GitHub repository synchronization failed');

    const repositories: GithubRepositoryAccess[] = [];
    const seenRepositoryIds = new Set<bigint>();
    const maximumPages = 1_000;
    for (let page = 1; page <= maximumPages; page += 1) {
      const response = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenData.token}`, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error('GitHub repository synchronization failed');
      const value = await response.json() as { repositories?: unknown[] };
      if (!Array.isArray(value.repositories)) throw new Error('GitHub repository synchronization failed');
      const pageRepositories = value.repositories.map((item) => this.repository(item));
      for (const repository of pageRepositories) {
        if (seenRepositoryIds.has(repository.id)) throw new Error('GitHub repository synchronization failed');
        seenRepositoryIds.add(repository.id);
      }
      repositories.push(...pageRepositories);
      if (pageRepositories.length < 100) return repositories;
    }
    throw new Error('GitHub repository synchronization failed');
  }

  async verifyInstallation(code: string, installationId: bigint): Promise<{ user: GithubAuthorizedUser; installation: GithubInstallationAccess }> {
    const accessToken = await this.exchangeToken(code);
    const [userResponse, installationResponse] = await Promise.all([
      fetch('https://api.github.com/user', {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(5_000),
      }),
      fetch(`https://api.github.com/user/installations/${installationId.toString()}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(5_000),
      }),
    ]);
    if (!userResponse.ok || !installationResponse.ok) throw new Error('GitHub installation verification failed');
    const user = await userResponse.json() as { id?: number; login?: string; name?: string | null; avatar_url?: string | null };
    const value = await installationResponse.json() as { id?: number; account?: { login?: string; type?: string }; suspended_at?: string | null };
    if (!Number.isSafeInteger(user.id) || typeof user.login !== 'string' || !Number.isSafeInteger(value.id) || BigInt(value.id as number) !== installationId || typeof value.account?.login !== 'string') {
      throw new Error('GitHub installation verification failed');
    }
    return {
      user: { id: BigInt(user.id as number), username: user.login, displayName: user.name ?? null, avatarUrl: user.avatar_url ?? null },
      installation: { id: installationId, accountType: value.account.type === 'Organization' ? 'ORGANIZATION' : 'USER', accountLogin: value.account.login, suspended: value.suspended_at != null },
    };
  }

  private async exchangeToken(code: string): Promise<string> {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.input.clientId, client_secret: this.input.clientSecret, code }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!tokenResponse.ok) throw new Error('GitHub token exchange failed');
    const tokenData = await tokenResponse.json() as { access_token?: string };
    if (tokenData.access_token === undefined) throw new Error('GitHub token exchange failed');
    return tokenData.access_token;
  }

  private repository(input: unknown): GithubRepositoryAccess {
    const value = input as {
      id?: number;
      owner?: { login?: string };
      name?: string;
      full_name?: string;
      private?: boolean;
      default_branch?: string;
      html_url?: string | null;
    };
    if (
      !Number.isSafeInteger(value.id) || typeof value.owner?.login !== 'string' || value.owner.login.length === 0 ||
      typeof value.name !== 'string' || value.name.length === 0 || typeof value.full_name !== 'string' || value.full_name.length === 0 ||
      typeof value.private !== 'boolean' || typeof value.default_branch !== 'string' || value.default_branch.length === 0 ||
      !(typeof value.html_url === 'string' || value.html_url === null)
    ) {
      throw new Error('GitHub repository synchronization failed');
    }
    return {
      id: BigInt(value.id as number),
      owner: value.owner.login,
      name: value.name,
      fullName: value.full_name,
      private: value.private,
      defaultBranch: value.default_branch,
      htmlUrl: value.html_url,
    };
  }

  private appJwt(): string {
    const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1_000);
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 30, exp: now + 540, iss: this.input.appId })}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    return `${unsigned}.${signer.sign(this.input.privateKey, 'base64url')}`;
  }
}
