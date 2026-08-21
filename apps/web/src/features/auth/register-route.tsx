"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { useAuthSession } from "@/auth/session-provider";
import { RegisterForm } from "./register-form";

export function RegisterRoute() {
  const router = useRouter();
  const { establishSession } = useAuthSession();
  return <AuthShell title="Create your workspace." description="Start with a Trace account, then connect development sources." note="Trace uses the same validation contract as the API and keeps session credentials out of browser storage.">
    <RegisterForm onAuthenticated={(session) => { establishSession(session); router.replace("/dashboard"); }} />
    <div className="auth-links"><span>Already have an account?</span><Link href="/login">Sign in</Link></div>
  </AuthShell>;
}
