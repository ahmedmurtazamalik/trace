import type { ReactNode } from "react";
interface DialogProps { open: boolean; title: string; description?: string; children?: ReactNode; onClose: () => void; }
export function Dialog({ open, title, description, children, onClose }: DialogProps) { if (!open) return null; return <div className="trace-dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="trace-dialog"><h2 id="dialog-title">{title}</h2>{description && <p>{description}</p>}{children}<button type="button" onClick={onClose}>Close</button></section></div>; }
