"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuthSession } from "./session-provider";

/** Prevents protected workspace content from flashing before auth is known. */
export function ProtectedSession({ children }: { children: ReactNode }) {
  const { status, error, isSigningOut } = useAuthSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (status !== "anonymous" || isSigningOut) return;
    const query = searchParams.toString();
    const returnTo = `${pathname}${query ? `?${query}` : ""}`;
    const invitationHash = /^\/invitations\/[A-Za-z0-9_-]+$/.test(pathname)
      && /^#token=[A-Za-z0-9_-]{43}$/.test(window.location.hash)
      ? window.location.hash
      : "";
    router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}${invitationHash}`);
  }, [isSigningOut, pathname, router, searchParams, status]);

  if (status === "authenticated") return children;
  if (status === "error") {
    return <section className="centered-state" role="alert"><h1>Session unavailable</h1><p>{error}</p><button type="button" onClick={() => window.location.reload()}>Try again</button></section>;
  }
  return <div className="session-loading" role="status" aria-live="polite"><span className="session-spinner" aria-hidden="true" />Verifying your secure session…</div>;
}
