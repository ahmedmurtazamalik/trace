import {
  Activity,
  ArrowUpRight,
  Files,
  GitCommitHorizontal,
  Radio,
  Users,
} from "lucide-react";
import { Badge, Card } from "@trace/ui";
import { workspaceFixture } from "@/mocks/fixtures/workspace";

const metricVisuals = [
  { accent: "signal", icon: Activity, label: "Live signal" },
  { accent: "violet", icon: Radio, label: "Repository signal" },
  { accent: "emerald", icon: Users, label: "Contributor signal" },
  { accent: "amber", icon: Files, label: "Change signal" },
] as const;

export function DashboardPreview() {
  return (
    <>
      <section className="metric-grid" aria-label="Illustrative workspace metrics">
        {workspaceFixture.metrics.map((metric, index) => {
          const visual = metricVisuals[index];
          const Icon = visual.icon;
          return (
            <Card
              className="metric-card"
              data-accent={visual.accent}
              key={metric.label}
              style={{ "--card-index": index } as React.CSSProperties}
            >
              <div className="metric-topline">
                <span>{metric.label}</span>
                <span className="metric-icon" aria-label={visual.label}><Icon size={17} /></span>
              </div>
              <strong>{metric.value}</strong>
              <div className="metric-footer"><small>{metric.note}</small><span className="micro-line" aria-hidden="true" /></div>
            </Card>
          );
        })}
      </section>
      <section className="dashboard-grid">
        <Card className="activity-card">
          <header className="section-heading">
            <div><span className="eyebrow">Latest signals</span><h2>Recent development activity</h2></div>
            <Badge>Fixture data</Badge>
          </header>
          <div className="activity-list">
            {workspaceFixture.activity.map((item, index) => (
              <article key={`${item.repository}-${item.time}`} style={{ "--row-index": index } as React.CSSProperties}>
                <span className="activity-icon"><GitCommitHorizontal size={18} aria-hidden="true" /></span>
                <div><strong>{item.message}</strong><p>{item.contributor} in <span>{item.repository}</span></p></div>
                <time>{item.time}</time>
              </article>
            ))}
          </div>
        </Card>
        <Card className="focus-card">
          <div className="focus-visual" aria-hidden="true"><span /><span /><span /><span /></div>
          <span className="eyebrow">Day 1 focus</span>
          <h2>Frontend foundation</h2>
          <p>The application shell, page routes, mock boundary, and accessible design system are ready for feature work.</p>
          <ul>
            <li><span />Independent of backend services</li>
            <li><span />Responsive navigation</li>
            <li><span />Typed UI primitives</li>
          </ul>
          <div className="next-marker">Next: authentication UI <ArrowUpRight size={17} aria-hidden="true" /></div>
        </Card>
      </section>
    </>
  );
}
