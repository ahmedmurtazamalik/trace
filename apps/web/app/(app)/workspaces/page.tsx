import { PageShell } from '@/components/page-shell';
import { WorkspaceRoute } from '@/features/workspaces/workspace-route';

export default function WorkspacesPage() {
  return <PageShell
    eyebrow="Team coordination"
    title="Workspaces"
    description="Create clear delivery boundaries, assign managers and developers, and group the repositories each team is responsible for."
  >
    <WorkspaceRoute />
  </PageShell>;
}
