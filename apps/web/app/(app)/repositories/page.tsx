import { PageShell } from "@/components/page-shell";
import { RepositoryRoute } from "@/features/repositories/repository-route";

export default function RepositoriesPage() {
  return <PageShell
    eyebrow="Source control"
    title="Repositories"
    description="Review what GitHub currently authorizes and independently choose which repositories Trace should track."
  >
    <RepositoryRoute />
  </PageShell>;
}
