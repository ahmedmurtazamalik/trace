import type { ReactNode } from "react";
import { Badge, Card } from "@trace/ui";
interface PageShellProps { eyebrow: string; title: string; description: string; upcoming?: string; children?: ReactNode; }
export function PageShell({ eyebrow, title, description, upcoming, children }: PageShellProps) { return <div className="page-stack"><header className="page-heading"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></header>{upcoming && <Card className="upcoming-card"><Badge>Planned</Badge><p>{upcoming}</p></Card>}{children}</div>; }
