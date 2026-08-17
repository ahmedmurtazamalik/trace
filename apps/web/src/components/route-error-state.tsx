"use client";

import { useEffect, useRef } from "react";

interface RouteErrorStateProps {
  reset(): void;
  error?: Error & { digest?: string };
  title?: string;
  actionLabel?: string;
}

export function RouteErrorState({
  reset,
  title = "Trace could not load this view.",
  actionLabel = "Try again",
}: RouteErrorStateProps) {
  const alertRef = useRef<HTMLElement>(null);

  useEffect(() => {
    alertRef.current?.focus();
  }, []);

  return <main ref={alertRef} className="centered-state" role="alert" tabIndex={-1}>
    <span>Error</span>
    <h1>{title}</h1>
    <p>Trace stopped this view safely. No sensitive system details were exposed.</p>
    <button type="button" onClick={reset}>{actionLabel}</button>
  </main>;
}
