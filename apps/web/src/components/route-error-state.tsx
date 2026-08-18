"use client";

import { useEffect, useRef } from "react";

interface RouteErrorStateProps {
  reset(): void;
  reload?(): void;
  error?: Error & { digest?: string };
  title?: string;
  actionLabel?: string;
}

function isStaleClientAssetError(error: RouteErrorStateProps["error"]): boolean {
  if (!error) return false;
  const signature = `${error.name} ${error.message}`.toLowerCase();
  return error.name === "ChunkLoadError"
    || signature.includes("loading chunk")
    || signature.includes("failed to fetch dynamically imported module");
}

export function RouteErrorState({
  reset,
  reload = () => window.location.reload(),
  error,
  title = "Trace could not load this view.",
  actionLabel = "Try again",
}: RouteErrorStateProps) {
  const alertRef = useRef<HTMLElement>(null);
  const staleClientAsset = isStaleClientAssetError(error);

  useEffect(() => {
    alertRef.current?.focus();
  }, []);

  return <main ref={alertRef} className="centered-state" role="alert" tabIndex={-1}>
    <span>Error</span>
    <h1>{title}</h1>
    <p>Trace stopped this view safely. No sensitive system details were exposed.</p>
    <button type="button" onClick={staleClientAsset ? reload : reset}>{staleClientAsset ? "Reload view" : actionLabel}</button>
  </main>;
}
