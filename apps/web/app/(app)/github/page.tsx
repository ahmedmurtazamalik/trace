import { Github } from "lucide-react";
import { Badge, Card } from "@trace/ui";
import { PageShell } from "@/components/page-shell";
export default function GitHubPage() { return <PageShell eyebrow="Integration" title="GitHub" description="Attach GitHub to your Trace account without changing how you sign in." upcoming="Connection, callback, and disconnect states arrive on Day 3."><Card className="integration-card"><span className="integration-icon"><Github size={24}/></span><div><h2>GitHub is not connected</h2><p>Trace account identity remains separate from your GitHub integration.</p></div><Badge>Preview only</Badge></Card></PageShell>; }
