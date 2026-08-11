import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trace — Engineering evidence",
  description: "Evidence-backed engineering activity reports.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <Link className="brand" href="/reports/demo" aria-label="Trace home">
            <span className="brand-mark" aria-hidden="true">
              T
            </span>
            <span>Trace</span>
          </Link>
          <nav aria-label="Primary navigation">
            <Link href="/reports/demo">Evidence report</Link>
            <Link href="/reports/new">New report</Link>
          </nav>
          <div className="read-only-indicator">
            <span aria-hidden="true" /> Read-only evidence
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
