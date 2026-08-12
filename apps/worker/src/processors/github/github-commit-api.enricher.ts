import { createSign } from 'node:crypto';
import type {
  GithubCommitEnricher,
  GithubCommitFacts,
  GithubCommitFileFacts,
  GithubContributorIdentity,
} from './github-commit.enricher';

interface GithubCommitApiEnricherOptions {
  appId: string;
  privateKey: string;
  request?: typeof fetch;
  timeoutMs?: number;
}

export class GithubCommitApiEnricher implements GithubCommitEnricher {
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: GithubCommitApiEnricherOptions) {
    this.request = options.request ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    if (options.appId.length === 0 || options.privateKey.length === 0 || this.timeoutMs < 1 || this.timeoutMs > 30_000) {
      throw new Error('GitHub commit enrichment is not configured.');
    }
  }

  async commit(input: {
    githubInstallationId: bigint;
    githubRepositoryId: bigint;
    owner: string;
    name: string;
    sha: string;
  }): Promise<GithubCommitFacts> {
    try {
      const token = await this.installationToken(input.githubInstallationId);
      const files: GithubCommitFileFacts[] = [];
      let result: GithubCommitFacts | undefined;
      for (let page = 1; page <= 3; page += 1) {
        const url = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/commits/${input.sha}?per_page=100&page=${page}`;
        const response = await this.request(url, {
          headers: this.headers(`Bearer ${token}`),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) throw new Error('provider response');
        const value = await this.json(response, 1_048_576);
        const parsed = this.page(value, input.sha);
        if (result === undefined) result = parsed.facts;
        files.push(...parsed.files);
        if (parsed.files.length < 100) return { ...result, files };
      }
      throw new Error('file pagination limit');
    } catch {
      throw new Error('GitHub commit enrichment failed.');
    }
  }

  private async installationToken(installationId: bigint): Promise<string> {
    const response = await this.request(`https://api.github.com/app/installations/${installationId.toString()}/access_tokens`, {
      method: 'POST',
      headers: this.headers(`Bearer ${this.appJwt()}`),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error('provider response');
    const value = await this.json(response, 65_536) as { token?: unknown };
    if (typeof value.token !== 'string' || value.token.length === 0 || value.token.length > 4_096) throw new Error('token response');
    return value.token;
  }

  private page(value: unknown, expectedSha: string): { facts: GithubCommitFacts; files: GithubCommitFileFacts[] } {
    const item = value as {
      sha?: unknown;
      commit?: { author?: { date?: unknown }; committer?: { date?: unknown } };
      author?: unknown;
      committer?: unknown;
      stats?: { additions?: unknown; deletions?: unknown };
      files?: unknown;
    };
    if (item.sha !== expectedSha || !Array.isArray(item.files) || item.files.length > 100) throw new Error('commit response');
    const authoredAt = this.date(item.commit?.author?.date);
    const committedAt = this.date(item.commit?.committer?.date);
    const additions = this.nonnegativeInteger(item.stats?.additions);
    const deletions = this.nonnegativeInteger(item.stats?.deletions);
    const files = item.files.map((file) => this.file(file));
    return {
      facts: {
        authoredAt,
        committedAt,
        author: this.identity(item.author),
        committer: this.identity(item.committer),
        additions,
        deletions,
        files: [],
      },
      files,
    };
  }

  private identity(value: unknown): GithubContributorIdentity | null {
    if (value === undefined || value === null) return null;
    const identity = value as { id?: unknown; login?: unknown; name?: unknown; avatar_url?: unknown };
    if (
      !Number.isSafeInteger(identity.id) || (identity.id as number) <= 0
      || typeof identity.login !== 'string' || identity.login.length === 0 || identity.login.length > 256
    ) return null;
    if (!(identity.name === undefined || identity.name === null || (typeof identity.name === 'string' && identity.name.length <= 256))) {
      throw new Error('identity response');
    }
    if (!(identity.avatar_url === undefined || identity.avatar_url === null || (typeof identity.avatar_url === 'string' && identity.avatar_url.length <= 2_048))) {
      throw new Error('identity response');
    }
    return {
      githubUserId: BigInt(identity.id as number),
      username: identity.login,
      displayName: typeof identity.name === 'string' ? identity.name : null,
      avatarUrl: typeof identity.avatar_url === 'string' ? identity.avatar_url : null,
    };
  }

  private file(value: unknown): GithubCommitFileFacts {
    const file = value as {
      filename?: unknown;
      status?: unknown;
      additions?: unknown;
      deletions?: unknown;
      previous_filename?: unknown;
    };
    if (!this.repositoryPath(file.filename)) {
      throw new Error('file response');
    }
    if (typeof file.status !== 'string' || !['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'].includes(file.status)) {
      throw new Error('file response');
    }
    if (!(
      file.previous_filename === undefined || file.previous_filename === null
      || this.repositoryPath(file.previous_filename)
    )) {
      throw new Error('file response');
    }
    return {
      path: file.filename,
      status: file.status,
      additions: this.nonnegativeInteger(file.additions),
      deletions: this.nonnegativeInteger(file.deletions),
      previousPath: typeof file.previous_filename === 'string' ? file.previous_filename : null,
    };
  }

  private date(value: unknown): Date {
    if (typeof value !== 'string') throw new Error('date response');
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new Error('date response');
    return parsed;
  }

  private repositoryPath(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 4_096 || value.includes('\\') || value.includes('\0')) {
      return false;
    }
    const segments = value.split('/');
    return !value.startsWith('/') && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  }

  private nonnegativeInteger(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2_147_483_647) throw new Error('numeric response');
    return value as number;
  }

  private async json(response: Response, maximumBytes: number): Promise<unknown> {
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength);
      if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) throw new Error('provider response size');
    }
    if (response.body === null) throw new Error('provider response body');
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('provider response size');
      }
      chunks.push(result.value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  }

  private headers(authorization: string): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: authorization,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private appJwt(): string {
    const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1_000);
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 30, exp: now + 540, iss: this.options.appId })}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    return `${unsigned}.${signer.sign(this.options.privateKey, 'base64url')}`;
  }
}
