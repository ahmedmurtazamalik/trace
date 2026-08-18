"use client";

import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SessionControls } from "./session-controls";
import { useReportDraftRecovery } from "./report-draft-recovery";
import { confirmDiscardUnsavedReportChanges, useUnsavedNavigationGuard } from "./unsaved-navigation";
import {
  Activity,
  BookOpen,
  Github,
  LayoutDashboard,
  Radio,
  Settings,
  Workflow,
} from "lucide-react";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/repositories", label: "Repositories", icon: BookOpen },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/reports", label: "Reports", icon: Workflow },
  { href: "/github", label: "GitHub", icon: Github },
  { href: "/settings", label: "Settings", icon: Settings },
];

function guardUnsavedNavigation(event: MouseEvent<HTMLAnchorElement>, dirty: boolean, onDiscard: () => void) {
  if (!dirty) return;
  const target = event.currentTarget.target;
  if (
    event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
    || (target !== "" && target !== "_self")
    || event.currentTarget.hasAttribute("download")
  ) return;
  if (!confirmDiscardUnsavedReportChanges(true)) {
    event.preventDefault();
    return;
  }
  onDiscard();
}

function Navigation({ dirty, mobile = false, onDiscard }: { dirty: boolean; mobile?: boolean; onDiscard: () => void }) {
  const path = usePathname();

  return (
    <nav
      aria-label={mobile ? "Mobile navigation" : "Primary navigation"}
      className={mobile ? "mobile-nav" : "sidebar-nav"}
    >
      {items.map(({ href, label, icon: Icon }, index) => (
        <Link
          href={href}
          key={href}
          aria-current={path === href ? "page" : undefined}
          className={path === href ? "nav-link active" : "nav-link"}
          style={{ "--nav-index": index } as React.CSSProperties}
          onClick={(event) => guardUnsavedNavigation(event, dirty, onDiscard)}
        >
          <span className="nav-icon"><Icon aria-hidden="true" size={18} /></span>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [reportedDirty, setReportedDirty] = useState(false);
  const { discardActive, hasActiveDraft, restorePending, stageActive } = useReportDraftRecovery();
  const reportDirty = reportedDirty || hasActiveDraft;
  const preserveDraftForRecovery = useCallback((url: string) => {
    stageActive(url);
  }, [stageActive]);
  const { clearGuard: clearUnsavedNavigationGuard } = useUnsavedNavigationGuard(
    reportDirty,
    preserveDraftForRecovery,
    discardActive,
    restorePending,
  );
  const discardUnsavedReport = () => {
    clearUnsavedNavigationGuard();
    discardActive();
    setReportedDirty(false);
  };
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ dirty?: boolean }>).detail;
      setReportedDirty(Boolean(detail?.dirty));
    };
    window.addEventListener("trace:report-editor-dirty", update);
    return () => window.removeEventListener("trace:report-editor-dirty", update);
  }, []);


  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <div data-testid="ambient-grid" className="sidebar-ambient" aria-hidden="true">
          <span /><span /><span />
        </div>
        <Link className="brand" href="/dashboard" aria-label="Trace Workspace" onClick={(event) => guardUnsavedNavigation(event, reportDirty, discardUnsavedReport)}>
          <span className="brand-mark"><Radio size={18} aria-hidden="true" /></span>
          <span className="brand-type">Trace<small>Workspace</small></span>
        </Link>
        <p className="workspace-label">Command center</p>
        <Navigation dirty={reportDirty} onDiscard={discardUnsavedReport} />
        <div className="connection-card">
          <span className="status-orbit"><span className="status-dot" /></span>
          <div><strong>Integration workspace</strong><small>Contract-validated frontend</small></div>
        </div>
      </aside>
      <div className="content-column">
        <header className="topbar">
          <div className="topbar-title">
            <span className="eyebrow">Trace workspace</span>
            <strong>Development activity</strong>
          </div>
          <SessionControls reportDirty={reportDirty} onDiscardUnsavedReport={discardUnsavedReport} />
        </header>
        <div className="data-disclosure">
          <span className="disclosure-icon"><Radio size={14} aria-hidden="true" /></span>
          <div><strong>Environment-aware data</strong><span>Production routes use authorized APIs; automated tests use disclosed contract fixtures.</span></div>
          <span className="preview-pill">Integration environment</span>
        </div>
        <main id="main-content" tabIndex={-1}>{children}</main>
        <Navigation dirty={reportDirty} mobile onDiscard={discardUnsavedReport} />
      </div>
    </div>
  );
}
