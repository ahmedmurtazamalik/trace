import { PageShell } from "@/components/page-shell";
import { ActivityRoute } from "@/features/activity/activity-route";

export default function ActivityPage() {
  return <PageShell eyebrow="Timeline" title="Activity" description="Filter and review source-neutral development work without exposing webhook internals.">
    <ActivityRoute />
  </PageShell>;
}
