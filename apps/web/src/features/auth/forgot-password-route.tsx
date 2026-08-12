import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export function ForgotPasswordRoute() {
  return <AuthShell title="Reset access." description="Request secure recovery without revealing whether an account exists." note="For privacy, Trace gives the same response whether or not an account exists.">
    <ForgotPasswordForm />
    <div className="auth-links"><Link href="/login">Back to sign in</Link></div>
  </AuthShell>;
}
