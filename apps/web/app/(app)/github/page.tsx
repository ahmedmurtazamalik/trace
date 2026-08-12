import { PageShell } from "@/components/page-shell";
import { GithubRoute } from "@/features/github/github-route";

export default function GitHubPage() {
  return <PageShell
    eyebrow="Integration"
    title="GitHub"
    description="Connect GitHub to your Trace account, then manage account authorization and GitHub App installation separately."
  >
    <GithubRoute />
  </PageShell>;
}
