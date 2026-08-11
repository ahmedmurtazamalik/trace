import Link from "next/link";
import { Input, Label } from "@trace/ui";
import { AuthShell } from "@/components/auth/auth-shell";
export default function ForgotPasswordPage() { return <AuthShell title="Reset access." description="Request secure recovery without revealing whether an account exists." note="Password recovery behavior begins on Day 2."><form className="auth-form"><Label htmlFor="identifier">Username or email</Label><Input id="identifier" disabled placeholder="your account"/><button type="button" disabled>Request reset — available Day 2</button><div className="auth-links"><Link href="/login">Back to sign in</Link></div></form></AuthShell>; }
