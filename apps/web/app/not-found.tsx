import Link from "next/link";
export default function NotFound() { return <main className="centered-state"><span>404</span><h1>Page not found</h1><p>The requested Trace view does not exist.</p><Link href="/dashboard">Return to dashboard</Link></main>; }
