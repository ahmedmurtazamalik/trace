export interface GithubContributorIdentity {
  githubUserId: bigint;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface GithubCommitFileFacts {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  previousPath: string | null;
}

export interface GithubCommitFacts {
  authoredAt: Date;
  committedAt: Date;
  author: GithubContributorIdentity | null;
  committer: GithubContributorIdentity | null;
  additions: number;
  deletions: number;
  files: GithubCommitFileFacts[];
}

export interface GithubCommitEnricher {
  commit(input: {
    githubInstallationId: bigint;
    githubRepositoryId: bigint;
    sha: string;
  }): Promise<GithubCommitFacts>;
}
