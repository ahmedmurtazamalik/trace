"use client";
export default function GlobalError({ reset }: { reset: () => void }) { return <html><body><main className="centered-state"><h1>Something went wrong.</h1><button onClick={reset}>Reload Trace</button></main></body></html>; }
