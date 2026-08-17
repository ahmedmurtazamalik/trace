"use client";

import { useEffect, useState, type ReactNode } from "react";

interface MockModeProviderProps {
  children: ReactNode;
  enabled?: boolean;
  startBrowserMocks?: () => Promise<void>;
}

type StartupState = "starting" | "ready" | "failed";

async function startDefaultBrowserMocks() {
  const { worker } = await import("./browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}

export function MockModeProvider({
  children,
  enabled = process.env.NEXT_PUBLIC_MSW_ENABLED === "true",
  startBrowserMocks = startDefaultBrowserMocks,
}: MockModeProviderProps) {
  const [state, setState] = useState<StartupState>(enabled ? "starting" : "ready");

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void startBrowserMocks().then(
      () => { if (active) setState("ready"); },
      () => { if (active) setState("failed"); },
    );
    return () => { active = false; };
  }, [enabled, startBrowserMocks]);

  if (state === "starting") return <p role="status" className="session-loading">Starting credential-free demo…</p>;
  if (state === "failed") return <p role="alert" className="session-loading">Trace could not start demo mode. Refresh the page or use the live frontend command.</p>;
  if (enabled) {
    return <>
      <aside role="note" className="mock-mode-disclosure">
        <strong>Demo data</strong>
        <span>No API, GitHub account, database, queue, or worker is connected.</span>
      </aside>
      {children}
    </>;
  }
  return children;
}
