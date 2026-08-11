"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="centered-state"><span>Error</span><h1>Trace could not load this view.</h1><p>No sensitive system details were exposed.</p><button onClick={reset}>Try again</button></main>; }
