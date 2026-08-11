import { Filter, GitCommitHorizontal } from "lucide-react";
import { Badge, Card } from "@trace/ui";
import { PageShell } from "@/components/page-shell";
import { workspaceFixture } from "@/mocks/fixtures/workspace";
export default function ActivityPage() { return <PageShell eyebrow="Timeline" title="Activity" description="A source-neutral timeline of meaningful development work." upcoming="Filtering and complete activity states arrive on Day 5."><Card className="preview-list-card"><div className="list-toolbar"><span><Filter size={16}/> Date · Repository · Contributor · Type</span><Badge>Illustrative</Badge></div>{workspaceFixture.activity.map(item => <article className="repo-row" key={item.message}><span className="repo-icon"><GitCommitHorizontal size={18}/></span><div><strong>{item.message}</strong><p>{item.contributor} · {item.repository}</p></div><time>{item.time}</time></article>)}</Card></PageShell>; }
