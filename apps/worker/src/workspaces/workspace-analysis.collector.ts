import { createSign } from 'node:crypto';
import {
  workspaceAnalysisCoverageSchema,
  workspaceAnalysisEvidenceSnapshotSchema,
  type WorkspaceAnalysisCoverage,
  type WorkspaceAnalysisEvidenceSnapshot,
} from '@trace/shared';

export interface WorkspaceAnalysisRepositoryInput {
  owner: string;
  name: string;
  defaultBranch: string;
  githubInstallationId: bigint;
}

export interface WorkspaceAnalysisCollection {
  toSha: string;
  dataCutoffAt: Date;
  coverage: WorkspaceAnalysisCoverage;
  evidence: WorkspaceAnalysisEvidenceSnapshot;
}

export interface WorkspaceAnalysisTarget {
  toSha: string;
  dataCutoffAt: Date;
}

const MAX_TREE_FILES = 10_000;
const MAX_ANALYZED_FILES = 256;
const MAX_ANALYZED_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_CONTENT_CHARS = 32_768;
const MAX_CHANGES = 3_000;
const binaryExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'gz', 'tar', '7z', 'rar', 'jar', 'woff', 'woff2', 'ttf', 'mp3', 'mp4', 'mov', 'wasm', 'bin', 'exe', 'dll', 'so']);
const languageNames: Record<string, string> = { ts: 'TypeScript', tsx: 'TypeScript React', js: 'JavaScript', jsx: 'JavaScript React', py: 'Python', md: 'Markdown', json: 'JSON', css: 'CSS', html: 'HTML', sql: 'SQL', prisma: 'Prisma', yml: 'YAML', yaml: 'YAML' };

export function isWorkspaceAnalysisBinaryPath(path: string): boolean {
  const lower = path.toLowerCase();
  const extension = lower.includes('.') ? lower.split('.').pop() ?? '' : '';
  return binaryExtensions.has(extension);
}

export function isWorkspaceAnalysisBinaryContent(content: Buffer): boolean {
  return content.includes(0);
}

class GitHubResponseError extends Error {
  constructor(readonly status: number) {
    super(`GitHub request failed with status ${status}.`);
  }
}

export function isContinuousComparisonStatus(value: unknown): boolean {
  return value === 'ahead' || value === 'identical';
}

export class WorkspaceAnalysisCollector {
  private readonly origin = (process.env.GITHUB_API_ORIGIN ?? 'https://api.github.com').replace(/\/$/, '');
  private readonly timeoutMs = 10_000;

  async resolveHead(input: WorkspaceAnalysisRepositoryInput): Promise<WorkspaceAnalysisTarget> {
    const token = await this.installationToken(input.githubInstallationId);
    return { toSha: await this.head(token, input), dataCutoffAt: new Date() };
  }

  async collect(input: WorkspaceAnalysisRepositoryInput, fromSha: string | null, target?: WorkspaceAnalysisTarget): Promise<WorkspaceAnalysisCollection> {
    const token = await this.installationToken(input.githubInstallationId);
    const resolved = target ?? { toSha: await this.head(token, input), dataCutoffAt: new Date() };
    const { toSha } = resolved;
    const tree = await this.tree(token, input, toSha);
    if (tree.truncated || tree.entries.length > MAX_TREE_FILES) throw new Error('Repository tree exceeds the supported baseline limit.');

    const files: WorkspaceAnalysisEvidenceSnapshot['files'] = [];
    const exclusions: Record<string, number> = {};
    let totalBytes = 0;
    let analyzedBytes = 0;
    let analyzedFiles = 0;
    let eligibleFiles = 0;
    let truncatedFiles = 0;

    for (const entry of tree.entries) {
      totalBytes += entry.size;
      const exclusion = this.exclusion(entry.path, entry.size);
      if (exclusion !== null) {
        exclusions[exclusion] = (exclusions[exclusion] ?? 0) + 1;
        files.push({ path: entry.path, blobSha: entry.sha, size: entry.size, language: this.language(entry.path), disposition: 'EXCLUDED', exclusionReason: exclusion, content: null });
        continue;
      }
      eligibleFiles += 1;
      if (analyzedFiles >= MAX_ANALYZED_FILES || analyzedBytes + entry.size > MAX_ANALYZED_BYTES) {
        const reason = analyzedFiles >= MAX_ANALYZED_FILES ? 'analysis-file-budget' : 'analysis-byte-budget';
        exclusions[reason] = (exclusions[reason] ?? 0) + 1;
        files.push({ path: entry.path, blobSha: entry.sha, size: entry.size, language: this.language(entry.path), disposition: 'EXCLUDED', exclusionReason: reason, content: null });
        continue;
      }
      const content = await this.blob(token, input, entry.sha);
      if (content === null) {
        eligibleFiles -= 1;
        exclusions['binary-content'] = (exclusions['binary-content'] ?? 0) + 1;
        files.push({ path: entry.path, blobSha: entry.sha, size: entry.size, language: this.language(entry.path), disposition: 'EXCLUDED', exclusionReason: 'binary-content', content: null });
        continue;
      }
      const truncated = content.length > MAX_CONTENT_CHARS;
      const bounded = content.slice(0, MAX_CONTENT_CHARS);
      analyzedFiles += 1;
      analyzedBytes += entry.size;
      if (truncated) truncatedFiles += 1;
      files.push({ path: entry.path, blobSha: entry.sha, size: entry.size, language: this.language(entry.path), disposition: truncated ? 'TRUNCATED' : 'ANALYZED', exclusionReason: truncated ? 'content-character-budget' : null, content: bounded });
    }

    let baselineOnly = fromSha === null;
    let changes: WorkspaceAnalysisEvidenceSnapshot['changes'] = [];
    if (fromSha !== null && fromSha !== toSha) {
      try {
        const comparison = await this.compare(token, input, fromSha, toSha);
        baselineOnly = !comparison.continuous;
        changes = comparison.changes;
      } catch (error) {
        if (!(error instanceof GitHubResponseError) || ![404, 409, 422].includes(error.status)) throw error;
        baselineOnly = true;
      }
      if (baselineOnly) exclusions['incremental-continuity-unproven'] = 1;
    }
    const coverage = workspaceAnalysisCoverageSchema.parse({
      totalFiles: tree.entries.length,
      eligibleFiles,
      analyzedFiles,
      excludedFiles: tree.entries.length - eligibleFiles,
      totalBytes,
      analyzedBytes,
      truncatedFiles,
    });
    const evidence = workspaceAnalysisEvidenceSnapshotSchema.parse({
      version: 1,
      defaultBranch: input.defaultBranch,
      baselineOnly,
      files,
      changes,
      exclusions,
    });
    return { toSha, dataCutoffAt: resolved.dataCutoffAt, coverage, evidence };
  }

  private async installationToken(installationId: bigint): Promise<string> {
    const value = await this.api(`/app/installations/${installationId.toString()}/access_tokens`, `Bearer ${this.appJwt()}`, { method: 'POST' }) as { token?: unknown };
    if (typeof value.token !== 'string' || value.token.length < 1 || value.token.length > 4_096) throw new Error('GitHub installation token response was invalid.');
    return value.token;
  }

  private async head(token: string, input: WorkspaceAnalysisRepositoryInput): Promise<string> {
    const value = await this.api(`/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/commits/${encodeURIComponent(input.defaultBranch)}`, `Bearer ${token}`) as { sha?: unknown };
    if (typeof value.sha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(value.sha)) throw new Error('GitHub branch head response was invalid.');
    return value.sha;
  }

  private async tree(token: string, input: WorkspaceAnalysisRepositoryInput, sha: string): Promise<{ truncated: boolean; entries: Array<{ path: string; sha: string; size: number }> }> {
    const value = await this.api(`/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/git/trees/${sha}?recursive=1`, `Bearer ${token}`, {}, 5 * 1024 * 1024) as { truncated?: unknown; tree?: unknown };
    if (typeof value.truncated !== 'boolean' || !Array.isArray(value.tree)) throw new Error('GitHub tree response was invalid.');
    const entries = value.tree.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'blob').map((item) => {
      if (typeof item.path !== 'string' || !this.repositoryPath(item.path) || typeof item.sha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(item.sha) || !Number.isSafeInteger(item.size) || (item.size as number) < 0) throw new Error('GitHub tree entry was invalid.');
      return { path: item.path, sha: item.sha, size: item.size as number };
    });
    return { truncated: value.truncated, entries };
  }

  private async blob(token: string, input: WorkspaceAnalysisRepositoryInput, sha: string): Promise<string | null> {
    const value = await this.api(`/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/git/blobs/${sha}`, `Bearer ${token}`, {}, 512 * 1024) as { encoding?: unknown; content?: unknown };
    if (value.encoding !== 'base64' || typeof value.content !== 'string') throw new Error('GitHub blob response was invalid.');
    const decoded = Buffer.from(value.content.replace(/\s/g, ''), 'base64');
    if (isWorkspaceAnalysisBinaryContent(decoded)) return null;
    return decoded.toString('utf8');
  }

  private async compare(token: string, input: WorkspaceAnalysisRepositoryInput, fromSha: string, toSha: string): Promise<{ continuous: boolean; changes: WorkspaceAnalysisEvidenceSnapshot['changes'] }> {
    const value = await this.api(`/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/compare/${fromSha}...${toSha}`, `Bearer ${token}`, {}, 5 * 1024 * 1024) as { status?: unknown; files?: unknown };
    if (!isContinuousComparisonStatus(value.status)) return { continuous: false, changes: [] };
    if (!Array.isArray(value.files) || value.files.length > MAX_CHANGES) throw new Error('GitHub compare response exceeded the supported limit.');
    const changes = value.files.map((raw) => {
      const file = raw as Record<string, unknown>;
      if (typeof file.filename !== 'string' || !this.repositoryPath(file.filename)) throw new Error('GitHub compare file was invalid.');
      const statusMap: Record<string, 'ADDED' | 'MODIFIED' | 'RENAMED' | 'DELETED'> = { added: 'ADDED', modified: 'MODIFIED', changed: 'MODIFIED', copied: 'ADDED', renamed: 'RENAMED', removed: 'DELETED' };
      if (typeof file.status !== 'string') throw new Error('GitHub compare status was invalid.');
      const status = statusMap[file.status];
      if (status === undefined) throw new Error('GitHub compare status was invalid.');
      const patch = typeof file.patch === 'string' ? file.patch : null;
      return {
        path: file.filename,
        previousPath: typeof file.previous_filename === 'string' && this.repositoryPath(file.previous_filename) ? file.previous_filename : null,
        status,
        additions: Number.isSafeInteger(file.additions) && (file.additions as number) >= 0 ? file.additions as number : null,
        deletions: Number.isSafeInteger(file.deletions) && (file.deletions as number) >= 0 ? file.deletions as number : null,
        patch: patch?.slice(0, 65_536) ?? null,
        truncationReason: patch !== null && patch.length > 65_536 ? 'patch-character-budget' : patch === null ? 'patch-unavailable' : null,
      };
    });
    return { continuous: true, changes };
  }

  private exclusion(path: string, size: number): string | null {
    const lower = path.toLowerCase();
    if (lower.split('/').some((part) => ['vendor', 'node_modules', 'dist', 'build', 'coverage', '.next', '.git'].includes(part))) return 'generated-or-vendored';
    if (size > MAX_FILE_BYTES) return 'oversized-file';
    if (isWorkspaceAnalysisBinaryPath(lower)) return 'binary-file';
    return null;
  }

  private language(path: string): string {
    const extension = path.toLowerCase().split('.').pop() ?? '';
    return languageNames[extension] ?? 'Text';
  }

  private repositoryPath(value: string): boolean {
    return value.length > 0 && value.length <= 1_024 && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
  }

  private appJwt(): string {
    const appId = process.env.GITHUB_APP_ID ?? '';
    const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
    if (appId.length === 0 || privateKey.length === 0) throw new Error('GitHub App analysis is not configured.');
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })).toString('base64url');
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    signer.end();
    return `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`;
  }

  private async api(path: string, authorization: string, init: RequestInit = {}, maxBytes = 256 * 1024): Promise<unknown> {
    const response = await fetch(`${this.origin}${path}`, {
      ...init,
      headers: { accept: 'application/vnd.github+json', authorization, 'user-agent': 'trace-workspace-analysis', 'x-github-api-version': '2022-11-28', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    if (text.length > maxBytes) throw new Error('GitHub response exceeded the supported size.');
    if (!response.ok) throw new GitHubResponseError(response.status);
    return JSON.parse(text) as unknown;
  }
}