import { AppShell } from "@/components/shell/app-shell";
import { ProtectedSession } from "@/auth/protected-session";
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) { return <ProtectedSession><AppShell>{children}</AppShell></ProtectedSession>; }
