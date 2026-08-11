import { DashboardPreview } from "@/components/dashboard/dashboard-preview";
import { PageShell } from "@/components/page-shell";
export default function DashboardPage() { return <PageShell eyebrow="Overview" title="Good morning, developer." description="A focused view of what moved across your workspace."><DashboardPreview/></PageShell>; }
