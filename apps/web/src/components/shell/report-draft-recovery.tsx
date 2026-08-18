"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ReportContent } from "@trace/shared";

export interface ReportDraftRecovery {
  content: ReportContent;
  reportId: string;
  revision: number;
}

interface PendingRecovery extends ReportDraftRecovery {
  url: string;
}

interface ReportDraftRecoveryContextValue {
  clearActive: (reportId: string, url: string) => void;
  consume: (reportId: string, revision: number, url: string) => ReportContent | undefined;
  discardActive: () => void;
  hasActiveDraft: boolean;
  publishActive: (recovery: ReportDraftRecovery) => void;
  recoveryGeneration: number;
  restorePending: () => void;
  stageActive: (url: string) => void;
}

const isolatedRecoveryContext: ReportDraftRecoveryContextValue = {
  clearActive: () => undefined,
  consume: () => undefined,
  discardActive: () => undefined,
  hasActiveDraft: false,
  publishActive: () => undefined,
  recoveryGeneration: 0,
  restorePending: () => undefined,
  stageActive: () => undefined,
};

const ReportDraftRecoveryContext = createContext<ReportDraftRecoveryContextValue | undefined>(undefined);

export function ReportDraftRecoveryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const activeRef = useRef<PendingRecovery>();
  const pendingRef = useRef<PendingRecovery>();
  const expiryRef = useRef<ReturnType<typeof setTimeout>>();
  const routeRetryRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [hasActiveDraft, setHasActiveDraft] = useState(false);
  const [recoveryGeneration, setRecoveryGeneration] = useState(0);

  const clearRouteRetries = useCallback(() => {
    for (const timeout of routeRetryRefs.current) clearTimeout(timeout);
    routeRetryRefs.current = [];
  }, []);
  useEffect(() => () => {
    clearRouteRetries();
    if (expiryRef.current) clearTimeout(expiryRef.current);
  }, [clearRouteRetries]);

  const publishActive = useCallback((recovery: ReportDraftRecovery) => {
    activeRef.current = { ...recovery, url: window.location.href };
    setHasActiveDraft(true);
  }, []);
  const stageActive = useCallback((url: string) => {
    pendingRef.current = activeRef.current ? { ...activeRef.current, url } : undefined;
  }, []);
  const discardActive = useCallback(() => {
    activeRef.current = undefined;
    setHasActiveDraft(false);
    pendingRef.current = undefined;
    if (expiryRef.current) clearTimeout(expiryRef.current);
    clearRouteRetries();
  }, [clearRouteRetries]);
  const clearActive = useCallback((reportId: string, url: string) => {
    const active = activeRef.current;
    if (!active || active.reportId !== reportId || active.url !== url) return;
    activeRef.current = undefined;
    setHasActiveDraft(false);
    pendingRef.current = undefined;
    if (expiryRef.current) clearTimeout(expiryRef.current);
    clearRouteRetries();
  }, [clearRouteRetries]);
  const restorePending = useCallback(() => {
    clearRouteRetries();
    setRecoveryGeneration((generation) => generation + 1);
    const pendingUrl = pendingRef.current?.url;
    if (expiryRef.current) clearTimeout(expiryRef.current);
    const staged = pendingRef.current;
    expiryRef.current = staged ? setTimeout(() => {
      if (pendingRef.current !== staged) return;
      pendingRef.current = undefined;
      const active = activeRef.current;
      if (active && active.reportId === staged.reportId && active.revision === staged.revision && active.url === staged.url) {
        activeRef.current = undefined;
        setHasActiveDraft(false);
      }
      clearRouteRetries();
    }, 10000) : undefined;
    if (pendingUrl) {
      const url = new URL(pendingUrl);
      const destination = `${url.pathname}${url.search}${url.hash}`;
      for (const delay of [50, 250, 750]) {
        const timeout = setTimeout(() => {
          router.replace(destination);
          router.refresh();
        }, delay);
        routeRetryRefs.current.push(timeout);
      }
    }
  }, [clearRouteRetries, router]);
  const consume = useCallback((reportId: string, revision: number, url: string) => {
    const pending = pendingRef.current;
    if (pending && pending.reportId === reportId && pending.revision === revision && pending.url === url) {
      pendingRef.current = undefined;
      if (expiryRef.current) clearTimeout(expiryRef.current);
      return pending.content;
    }
    const active = activeRef.current;
    if (!active || active.reportId !== reportId || active.revision !== revision || active.url !== url) return undefined;
    return active.content;
  }, []);

  const value = useMemo(() => ({ clearActive, consume, discardActive, hasActiveDraft, publishActive, recoveryGeneration, restorePending, stageActive }), [
    clearActive,
    consume,
    discardActive,
    hasActiveDraft,
    publishActive,
    recoveryGeneration,
    restorePending,
    stageActive,
  ]);
  return <ReportDraftRecoveryContext.Provider value={value}>{children}</ReportDraftRecoveryContext.Provider>;
}

export function useReportDraftRecovery(): ReportDraftRecoveryContextValue {
  return useContext(ReportDraftRecoveryContext) ?? isolatedRecoveryContext;
}
