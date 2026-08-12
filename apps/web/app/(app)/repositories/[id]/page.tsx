import { PageShell } from "@/components/page-shell";
import { RepositoryDetailPanel } from "@/features/repositories/repository-detail-panel";

export default async function RepositoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PageShell eyebrow="Source control" title="Repository details" description="Review current GitHub authorization and the historical activity retained by Trace."><RepositoryDetailPanel repositoryId={id} /></PageShell>;
}
