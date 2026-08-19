import type { ReactNode } from "react";
import Link from "next/link";
import { Radio } from "lucide-react";

export function AuthShell({ title, description, note, children }: { title: string; description: string; note: string; children?: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link className="brand auth-brand" href="/">
          <span className="brand-mark"><Radio size={18} aria-hidden="true" /></span>
          <span className="brand-type">Trace<small>Workspace</small></span>
        </Link>
        <div className="auth-copy"><span className="eyebrow">Secure developer workspace</span><h1>{title}</h1><p>{description}</p></div>
        {children}
        <p className="planned-note">{note}</p>
      </section>
      <aside className="auth-aside" aria-label="Product overview">
        <div className="auth-grid" aria-hidden="true" />
        <div className="auth-signal" aria-hidden="true">
          <span className="signal-node node-one" /><span className="signal-node node-two" /><span className="signal-node node-three" />
          <span className="signal-path path-one" /><span className="signal-path path-two" />
        </div>
        <div className="auth-message"><span className="signal-line" /><h2>See the shape of the work, not just the commits.</h2><p>Trace turns repository signals into a clear, defensible narrative of progress.</p></div>
        <dl><div><dt>Identity</dt><dd>Trace account first</dd></div><div><dt>Integration</dt><dd>GitHub connects later</dd></div><div><dt>Reports</dt><dd>Structured and editable</dd></div></dl>
      </aside>
    </main>
  );
}
