"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { useAuthSession, safeReturnPath } from "@/auth/session-provider";
import { LoginForm } from "./login-form";

export function LoginRoute() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { establishSession, status } = useAuthSession();
  return <AuthShell title="Welcome back." description="Sign in to review your development activity." note="Your session stays in a secure HTTP-only cookie; Trace never stores it in browser storage.">
    <LoginForm sessionReady={status !== "loading"} onAuthenticated={(session) => {
      establishSession(session);
      const returnTo = safeReturnPath(searchParams.get("returnTo"));
      const invitationHash = /^\/invitations\/[A-Za-z0-9_-]+(?:\?.*)?$/.test(returnTo)
        && /^#token=[A-Za-z0-9_-]{43}$/.test(window.location.hash)
        ? window.location.hash
        : "";
      router.replace(`${returnTo}${invitationHash}`);
    }} />
    <div className="auth-links"><Link href="/forgot-password">Forgot password?</Link></div>
  </AuthShell>;
}
