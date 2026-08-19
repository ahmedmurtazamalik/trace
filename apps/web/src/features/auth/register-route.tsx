"use client";

import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";

export function RegisterRoute() {
  return <AuthShell title="Account creation is closed." description="Trace is moving to verified GitHub sign-in so repository identity and account identity match." note="Existing Trace accounts remain available during the transition.">
    <div className="auth-alert" role="status">Public username registration is disabled. GitHub signup will replace it.</div>
    <div className="auth-links"><Link href="/login">Sign in with an existing account</Link></div>
  </AuthShell>;
}
