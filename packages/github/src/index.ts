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

type GithubUserPayload = {
  id?: number;
  login?: string;
  name?: string | null;
  avatar_url?: string | null;
};

type GithubInstallationPayload = {
  id?: number;
  account?: { login?: string; type?: string };
  suspended_at?: string | null;
};

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
    if (code === 'fake-switch-code') {
      return Promise.resolve({
        user: { id: 583_232n, username: 'fake-switcher', displayName: 'Fake Switcher', avatarUrl: 'https://avatars.githubusercontent.com/u/583232' },
      });
    }
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
    await this.requireOk(tokenResponse, 'GitHub token exchange failed');
    const tokenData = await this.boundedJson(tokenResponse, 65_536, 'GitHub token exchange failed') as { access_token?: string };
    if (!this.boundedString(tokenData.access_token, 1_024)) throw new Error('GitHub token exchange failed');
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenData.access_token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(5_000),
    });
    await this.requireOk(userResponse, 'GitHub user lookup failed');
    const user = await this.boundedJson(userResponse, 262_144, 'GitHub user lookup failed') as GithubUserPayload;
    if (!this.validUser(user)) throw new Error('GitHub user lookup failed');
    return { user: { id: BigInt(user.id), username: user.login, displayName: user.name ?? null, avatarUrl: user.avatar_url ?? null } };
  }

  async installation(installationId: bigint): Promise<GithubInstallationAccess> {
    const response = await fetch(`https://api.github.com/app/installations/${installationId.toString()}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.appJwt()}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(5_000),
    });
    await this.requireOk(response, 'GitHub installation lookup failed');
    const value = await this.boundedJson(response, 262_144, 'GitHub installation lookup failed') as GithubInstallationPayload;
    const accountLogin = value.account?.login;
    if (!Number.isSafeInteger(value.id) || BigInt(value.id as number) !== installationId || !this.boundedString(accountLogin, 100)) {
      throw new Error('GitHub installation lookup failed');
    }
    return {
      id: installationId,
      accountType: value.account?.type === 'Organization' ? 'ORGANIZATION' : 'USER',
      accountLogin,
      suspended: value.suspended_at != null,
    };
  }

  async repositories(installationId: bigint): Promise<GithubRepositoryAccess[]> {
    const tokenResponse = await fetch(`https://api.github.com/app/installations/${installationId.toString()}/access_tokens`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.appJwt()}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(5_000),
    });
    await this.requireOk(tokenResponse, 'GitHub repository synchronization failed');
    const tokenData = await this.boundedJson(tokenResponse, 65_536, 'GitHub repository synchronization failed') as { token?: string };
    if (!this.boundedString(tokenData.token, 1_024)) throw new Error('GitHub repository synchronization failed');

    const repositories: GithubRepositoryAccess[] = [];
    const seenRepositoryIds = new Set<bigint>();
    const maximumPages = 100;
    for (let page = 1; page <= maximumPages; page += 1) {
      const response = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenData.token}`, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(5_000),
      });
      await this.requireOk(response, 'GitHub repository synchronization failed');
      const value = await this.boundedJson(response, 2_097_152, 'GitHub repository synchronization failed') as { repositories?: unknown[] };
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
    const fetchResults = await Promise.allSettled([
      fetch('https://api.github.com/user', {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(5_000),
      }),
      fetch(`https://api.github.com/user/installations/${installationId.toString()}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(5_000),
      }),
    ]);
    if (fetchResults[0].status === 'rejected' || fetchResults[1].status === 'rejected') {
      await Promise.all(fetchResults.map(async (result) => {
        if (result.status === 'fulfilled') await this.cancel(result.value);
      }));
      throw new Error('GitHub installation verification failed');
    }
    const userResponse = fetchResults[0].value;
    const installationResponse = fetchResults[1].value;
    if (!userResponse.ok || !installationResponse.ok) {
      await Promise.all([this.cancel(userResponse), this.cancel(installationResponse)]);
      throw new Error('GitHub installation verification failed');
    }
    const [userResult, installationResult] = await Promise.allSettled([
      this.boundedJson(userResponse, 262_144, 'GitHub installation verification failed'),
      this.boundedJson(installationResponse, 262_144, 'GitHub installation verification failed'),
    ]);
    if (userResult.status === 'rejected' || installationResult.status === 'rejected') {
      throw new Error('GitHub installation verification failed');
    }
    const user = userResult.value as GithubUserPayload;
    const value = installationResult.value as GithubInstallationPayload;
    const accountLogin = value.account?.login;
    if (!this.validUser(user) || !Number.isSafeInteger(value.id) || BigInt(value.id as number) !== installationId || !this.boundedString(accountLogin, 100)) {
      throw new Error('GitHub installation verification failed');
    }
    return {
      user: { id: BigInt(user.id), username: user.login, displayName: user.name ?? null, avatarUrl: user.avatar_url ?? null },
      installation: { id: installationId, accountType: value.account?.type === 'Organization' ? 'ORGANIZATION' : 'USER', accountLogin, suspended: value.suspended_at != null },
    };
  }

  private async exchangeToken(code: string): Promise<string> {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.input.clientId, client_secret: this.input.clientSecret, code }),
      signal: AbortSignal.timeout(5_000),
    });
    await this.requireOk(tokenResponse, 'GitHub token exchange failed');
    const tokenData = await this.boundedJson(tokenResponse, 65_536, 'GitHub token exchange failed') as { access_token?: string };
    if (!this.boundedString(tokenData.access_token, 1_024)) throw new Error('GitHub token exchange failed');
    return tokenData.access_token;
  }

  private async boundedJson(response: Response, maximum: number, failure: string): Promise<unknown> {
    try {
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) {
        await this.cancel(response);
        throw new Error('oversized response');
      }
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error('missing response body');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        bytes += result.value.byteLength;
        if (bytes > maximum) {
          await reader.cancel().catch(() => undefined);
          throw new Error('oversized response');
        }
        chunks.push(result.value);
      }
      const output = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(output)) as unknown;
    } catch {
      throw new Error(failure);
    }
  }

  private async requireOk(response: Response, failure: string): Promise<void> {
    if (response.ok) return;
    await this.cancel(response);
    throw new Error(failure);
  }

  private async cancel(response: Response): Promise<void> {
    await response.body?.cancel().catch(() => undefined);
  }

  private boundedString(value: unknown, maximum: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum;
  }

  private validUser(value: GithubUserPayload): value is GithubUserPayload & { id: number; login: string } {
    return Number.isSafeInteger(value.id) && (value.id ?? 0) > 0
      && this.boundedString(value.login, 100)
      && (value.name === undefined || value.name === null || (typeof value.name === 'string' && value.name.length <= 256))
      && (value.avatar_url === undefined || value.avatar_url === null || this.validHttpsUrl(value.avatar_url, 'avatars.githubusercontent.com'));
  }

  private validHttpsUrl(value: string, host: string): boolean {
    if (value.length === 0 || value.length > 2_048) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === host && url.username === '' && url.password === '';
    } catch {
      return false;
    }
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
    const owner = value.owner?.login;
    const name = value.name;
    const fullName = value.full_name;
    const defaultBranch = value.default_branch;
    const htmlUrl = value.html_url;
    if (
      !Number.isSafeInteger(value.id) || (value.id ?? 0) <= 0 ||
      !this.boundedString(owner, 100) || !this.boundedString(name, 100) || !this.boundedString(fullName, 512) ||
      typeof value.private !== 'boolean' || !this.boundedString(defaultBranch, 255) ||
      !(htmlUrl === null || (typeof htmlUrl === 'string' && this.validHttpsUrl(htmlUrl, 'github.com')))
    ) {
      throw new Error('GitHub repository synchronization failed');
    }
    return {
      id: BigInt(value.id as number),
      owner,
      name,
      fullName,
      private: value.private,
      defaultBranch,
      htmlUrl,
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
