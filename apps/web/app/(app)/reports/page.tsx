import { FileText } from "lucide-react";
import { Card, EmptyState } from "@trace/ui";
import { PageShell } from "@/components/page-shell";
export default function ReportsPage() { return <PageShell eyebrow="Daily narrative" title="Reports" description="Turn verified development activity into structured, editable reports." upcoming="Report creation, history, and status tracking arrive on Day 8."><Card className="empty-card"><FileText size={26}/><EmptyState title="No reports yet" description="Reports will appear here after the report workflow is implemented."/></Card></PageShell>; }
