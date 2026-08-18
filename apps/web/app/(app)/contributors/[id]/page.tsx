import { PageShell } from "@/components/page-shell";
import { ContributorActivityRoute } from "@/features/activity/contributor-activity-route";

export default async function ContributorActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <PageShell
    eyebrow="Development activity"
    title="Contributor activity"
    description="Review development activity associated with this contributor across authorized repositories."
  >
    <ContributorActivityRoute contributorId={id} />
  </PageShell>;
}
