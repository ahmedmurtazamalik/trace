import { PageShell } from "@/components/page-shell";
import { ReportsRoute } from "@/features/reports/reports-route";

export default function ReportsPage() {
  return <PageShell eyebrow="Daily narrative" title="Development activity reports" description="Request and track structured reports built from authorized development activity."><ReportsRoute /></PageShell>;
}
