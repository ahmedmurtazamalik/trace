import { PageShell } from "@/components/page-shell";
import { DashboardRoute } from "@/features/dashboard/dashboard-route";

export default function DashboardPage() {
  return <PageShell eyebrow="Overview" title="Development dashboard" description="See deterministic activity totals and recent work for the selected day.">
    <DashboardRoute />
  </PageShell>;
}
