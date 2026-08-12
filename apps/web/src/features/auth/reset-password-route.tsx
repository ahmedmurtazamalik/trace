"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

export function ResetPasswordRoute() {
  const token = useSearchParams().get("token");
  return <AuthShell title="Choose a new password." description="Complete recovery with a valid, single-use reset link." note="Reset links expire after 30 minutes and can only be used once.">
    <ResetPasswordForm token={token} />
    <div className="auth-links"><Link href="/login">Back to sign in</Link></div>
  </AuthShell>;
}
