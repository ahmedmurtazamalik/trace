"use client";

import { RouteErrorState } from "@/components/route-error-state";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body><RouteErrorState error={error} reset={reset} title="Something went wrong." actionLabel="Reload Trace" /></body></html>;
}
