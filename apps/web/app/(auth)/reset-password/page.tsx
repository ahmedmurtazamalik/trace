import Link from "next/link";
import { Input, Label } from "@trace/ui";
import { AuthShell } from "@/components/auth/auth-shell";
export default function ResetPasswordPage() { return <AuthShell title="Choose a new password." description="Complete recovery with a valid, single-use reset link." note="Password reset behavior begins on Day 2."><form className="auth-form"><Label htmlFor="password">New password</Label><Input id="password" type="password" disabled placeholder="Minimum 12 characters"/><button type="button" disabled>Update password — available Day 2</button><div className="auth-links"><Link href="/login">Back to sign in</Link></div></form></AuthShell>; }
