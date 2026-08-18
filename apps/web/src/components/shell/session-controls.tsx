"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useOptionalAuthSession } from "@/auth/session-provider";
import { confirmDiscardUnsavedReportChanges } from "./unsaved-navigation";

export function SessionControls({
  reportDirty = false,
  onDiscardUnsavedReport,
}: {
  reportDirty?: boolean;
  onDiscardUnsavedReport?: () => void;
}) {
  const session = useOptionalAuthSession();
  const router = useRouter();
  const [error, setError] = useState<string>();
  if (!session || session.status !== "authenticated") return <div className="topbar-status"><span className="live-signal" />Interface online</div>;

  async function handleSignOut() {
    if (!confirmDiscardUnsavedReportChanges(reportDirty)) return;
    setError(undefined);
    try {
      const didSignOut = await session?.signOut();
      if (didSignOut) {
        onDiscardUnsavedReport?.();
        router.replace("/login");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Trace could not sign out. Please try again.");
    }
  }

  return <div className="session-controls">
    <div className="session-identity"><span>{session.user?.displayName ?? session.user?.username}</span><small>@{session.user?.username}</small></div>
    {error && <span className="session-control-error" role="alert">{error}</span>}
    <button type="button" onClick={handleSignOut} disabled={session.isSigningOut} aria-label="Sign out"><LogOut size={16} aria-hidden="true" /><span>{session.isSigningOut ? "Signing out…" : "Sign out"}</span></button>
  </div>;
}
