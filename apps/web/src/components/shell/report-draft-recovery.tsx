"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
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
  consume: (reportId: string, revision: number, url: string) => ReportContent | undefined;
  discardActive: () => void;
  publishActive: (recovery: ReportDraftRecovery | undefined, unmounting?: boolean) => void;
  recoveryGeneration: number;
  restorePending: () => void;
  stageActive: (url: string) => void;
}

const isolatedRecoveryContext: ReportDraftRecoveryContextValue = {
  consume: () => undefined,
  discardActive: () => undefined,
  publishActive: () => undefined,
  recoveryGeneration: 0,
  restorePending: () => undefined,
  stageActive: () => undefined,
};

const ReportDraftRecoveryContext = createContext<ReportDraftRecoveryContextValue | undefined>(undefined);

export function ReportDraftRecoveryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const activeRef = useRef<ReportDraftRecovery>();
  const pendingRef = useRef<PendingRecovery>();
  const expiryRef = useRef<ReturnType<typeof setTimeout>>();
  const [recoveryGeneration, setRecoveryGeneration] = useState(0);

  const publishActive = useCallback((recovery: ReportDraftRecovery | undefined, unmounting = false) => {
    if (recovery) activeRef.current = recovery;
    else if (!unmounting) {
      const previousActive = activeRef.current;
      setTimeout(() => {
        if (activeRef.current !== previousActive) return;
        activeRef.current = undefined;
        pendingRef.current = undefined;
        if (expiryRef.current) clearTimeout(expiryRef.current);
      }, 0);
    }
  }, []);
  const stageActive = useCallback((url: string) => {
    pendingRef.current = activeRef.current ? { ...activeRef.current, url } : undefined;
  }, []);
  const discardActive = useCallback(() => {
    activeRef.current = undefined;
    pendingRef.current = undefined;
    if (expiryRef.current) clearTimeout(expiryRef.current);
  }, []);
  const restorePending = useCallback(() => {
    setRecoveryGeneration((generation) => generation + 1);
    const pendingUrl = pendingRef.current?.url;
    if (expiryRef.current) clearTimeout(expiryRef.current);
    expiryRef.current = setTimeout(() => { pendingRef.current = undefined; }, 10000);
    if (pendingUrl) {
      const url = new URL(pendingUrl);
      const destination = `${url.pathname}${url.search}${url.hash}`;
      for (const delay of [50, 250, 750]) {
        setTimeout(() => {
          router.replace(destination);
          router.refresh();
        }, delay);
      }
    }
  }, [router]);
  const consume = useCallback((reportId: string, revision: number, url: string) => {
    const pending = pendingRef.current;
    if (!pending || pending.reportId !== reportId || pending.revision !== revision || pending.url !== url) return undefined;
    return pending.content;
  }, []);

  const value = useMemo(() => ({ consume, discardActive, publishActive, recoveryGeneration, restorePending, stageActive }), [
    consume,
    discardActive,
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
