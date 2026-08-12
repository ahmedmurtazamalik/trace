"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthSessionResponse, PublicUser } from "@trace/shared";
import { AuthApiError, getSession, logout } from "@/api/auth";

type SessionStatus = "loading" | "authenticated" | "anonymous" | "error";
type LoadSession = typeof getSession;
type RevokeSession = typeof logout;

interface AuthSessionValue {
  status: SessionStatus;
  user?: PublicUser;
  error?: string;
  isSigningOut: boolean;
  establishSession(session: AuthSessionResponse): void;
  signOut(): Promise<void>;
}

interface AuthSessionProviderProps {
  children: ReactNode;
  initialSession?: AuthSessionResponse;
  loadSession?: LoadSession;
  revokeSession?: RevokeSession;
}

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

/**
 * Keeps public user and CSRF state only in React memory. The actual session
 * credential remains exclusively in the backend's HTTP-only cookie.
 */
export function AuthSessionProvider({
  children,
  initialSession,
  loadSession = getSession,
  revokeSession = logout,
}: AuthSessionProviderProps) {
  const [session, setSession] = useState<AuthSessionResponse | undefined>(initialSession);
  const [status, setStatus] = useState<SessionStatus>(initialSession ? "authenticated" : "loading");
  const [error, setError] = useState<string>();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const bootstrapController = useRef<AbortController>();
  const sessionGeneration = useRef(0);

  useEffect(() => {
    if (initialSession) return;
    const controller = new AbortController();
    const generation = ++sessionGeneration.current;
    bootstrapController.current = controller;
    loadSession({ signal: controller.signal })
      .then((loaded) => {
        if (generation !== sessionGeneration.current) return;
        setSession(loaded);
        setStatus("authenticated");
      })
      .catch((reason: unknown) => {
        if (generation !== sessionGeneration.current) return;
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (reason instanceof AuthApiError && reason.code === "UNAUTHENTICATED") {
          setStatus("anonymous");
          return;
        }
        setError(reason instanceof AuthApiError ? reason.message : "Trace could not verify your session.");
        setStatus("error");
      });
    return () => {
      controller.abort();
      if (bootstrapController.current === controller) bootstrapController.current = undefined;
    };
  }, [initialSession, loadSession]);

  const establishSession = useCallback((nextSession: AuthSessionResponse) => {
    sessionGeneration.current += 1;
    bootstrapController.current?.abort();
    bootstrapController.current = undefined;
    setIsSigningOut(false);
    setSession(nextSession);
    setError(undefined);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    const generation = ++sessionGeneration.current;
    setIsSigningOut(true);
    try {
      if (session?.csrfToken) await revokeSession(session.csrfToken);
      if (generation !== sessionGeneration.current) return;
      setSession(undefined);
      setError(undefined);
      setStatus("anonymous");
    } catch (reason) {
      if (generation === sessionGeneration.current) setIsSigningOut(false);
      throw reason;
    }
  }, [revokeSession, session]);

  const value = useMemo<AuthSessionValue>(() => ({
    status,
    user: session?.user,
    error,
    isSigningOut,
    establishSession,
    signOut,
  }), [error, establishSession, isSigningOut, session?.user, signOut, status]);

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionValue {
  const context = useContext(AuthSessionContext);
  if (!context) throw new Error("useAuthSession must be used inside AuthSessionProvider.");
  return context;
}

/** Allows shared visual components to stay renderable in isolated tests. */
export function useOptionalAuthSession(): AuthSessionValue | null {
  return useContext(AuthSessionContext);
}

/** Allows only local protected paths and closes auth-loop/open-redirect values. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/dashboard";
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "/dashboard";
  }
  if (decoded.startsWith("//") || decoded.includes("\\")) return "/dashboard";
  const pathname = decoded.split(/[?#]/, 1)[0];
  if (["/login", "/register", "/forgot-password", "/reset-password"].includes(pathname)) return "/dashboard";
  return value;
}
