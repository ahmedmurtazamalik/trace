"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpen, Github, LayoutDashboard, Radio, Settings, Workflow } from "lucide-react";
const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/repositories", label: "Repositories", icon: BookOpen },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/reports", label: "Reports", icon: Workflow },
  { href: "/github", label: "GitHub", icon: Github },
  { href: "/settings", label: "Settings", icon: Settings },
];
function Navigation({ mobile = false }: { mobile?: boolean }) { const path = usePathname(); return <nav aria-label={mobile ? "Mobile navigation" : "Primary navigation"} className={mobile ? "mobile-nav" : "sidebar-nav"}>{items.map(({ href, label, icon: Icon }) => <Link href={href} key={href} aria-current={path === href ? "page" : undefined} className={path === href ? "nav-link active" : "nav-link"}><Icon aria-hidden="true" size={18}/><span>{label}</span></Link>)}</nav>; }
export function AppShell({ children }: { children: ReactNode }) { return <div className="app-frame"><a className="skip-link" href="#main-content">Skip to content</a><aside className="sidebar"><Link className="brand" href="/dashboard"><span className="brand-mark"><Radio size={18}/></span><span>Trace</span></Link><p className="workspace-label">Developer workspace</p><Navigation/><div className="connection-card"><span className="status-dot"/>Preview mode<small>Frontend foundation</small></div></aside><div className="content-column"><header className="topbar"><div><span className="eyebrow">Workspace</span><strong>Development activity</strong></div><span className="preview-pill">Illustrative data</span></header><div className="data-disclosure"><span className="status-dot amber"/><strong>Illustrative frontend data.</strong> No API, GitHub account, or database is connected.</div><main id="main-content" tabIndex={-1}>{children}</main><Navigation mobile/></div></div>; }
