import { act, render, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportContent } from "@trace/shared";
import { AuthSessionProvider, useAuthSession } from "@/auth/session-provider";
import { ReportDraftRecoveryProvider, useReportDraftRecovery } from "./report-draft-recovery";

const content = (executiveSummary: string): ReportContent => ({
  executiveSummary,
  repositories: [],
});

describe("ReportDraftRecoveryProvider", () => {
  afterEach(() => vi.useRealTimers());

  it("consumes the staged snapshot once and then serves the newest active draft", () => {
    let recovery!: ReturnType<typeof useReportDraftRecovery>;
    function Harness() { recovery = useReportDraftRecovery(); return null; }
    window.history.replaceState({}, "", "/reports/report-1");
    render(<ReportDraftRecoveryProvider><Harness /></ReportDraftRecoveryProvider>);

    act(() => {
      recovery.publishActive({ content: content("first"), reportId: "report-1", revision: 1 });
      recovery.stageActive(window.location.href);
    });
    expect(recovery.hasActiveDraft).toBe(true);
    expect(recovery.consume("report-1", 1, window.location.href)?.executiveSummary).toBe("first");

    act(() => recovery.publishActive({ content: content("newest"), reportId: "report-1", revision: 1 }));
    expect(recovery.consume("report-1", 1, window.location.href)?.executiveSummary).toBe("newest");
    act(() => recovery.clearActive("report-1", window.location.href));
    expect(recovery.hasActiveDraft).toBe(false);
  });

  it("cancels every scheduled route retry when recovery is discarded", () => {
    vi.useFakeTimers();
    const router = useRouter() as unknown as { refresh: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn> };
    router.refresh.mockClear();
    router.replace.mockClear();
    let recovery!: ReturnType<typeof useReportDraftRecovery>;
    function Harness() { recovery = useReportDraftRecovery(); return null; }
    render(<ReportDraftRecoveryProvider><Harness /></ReportDraftRecoveryProvider>);

    act(() => {
      recovery.publishActive({ content: content("draft"), reportId: "report-1", revision: 1 });
      recovery.stageActive("http://localhost/reports/report-1");
      recovery.restorePending();
      recovery.discardActive();
      vi.runAllTimers();
    });

    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("expires an unrestored draft instead of leaking it across later lifecycles", () => {
    vi.useFakeTimers();
    let recovery!: ReturnType<typeof useReportDraftRecovery>;
    function Harness() { recovery = useReportDraftRecovery(); return null; }
    window.history.replaceState({}, "", "/reports/report-1");
    render(<ReportDraftRecoveryProvider><Harness /></ReportDraftRecoveryProvider>);

    act(() => {
      recovery.publishActive({ content: content("unrestored"), reportId: "report-1", revision: 1 });
      recovery.stageActive(window.location.href);
      recovery.restorePending();
      vi.advanceTimersByTime(10_000);
    });

    expect(recovery.hasActiveDraft).toBe(false);
    expect(recovery.consume("report-1", 1, window.location.href)).toBeUndefined();
  });

  it("discards recovery when a fresh session is established, even for the same user", async () => {
    const initialSession = {
      user: { id: "usr-1", username: "alice", displayName: "Alice", email: null, createdAt: "2026-08-18T00:00:00.000Z" },
      csrfToken: "old-csrf",
    };
    let recovery!: ReturnType<typeof useReportDraftRecovery>;
    let establishSession!: ReturnType<typeof useAuthSession>["establishSession"];
    function Harness() {
      recovery = useReportDraftRecovery();
      establishSession = useAuthSession().establishSession;
      return null;
    }
    render(
      <AuthSessionProvider initialSession={initialSession}>
        <ReportDraftRecoveryProvider><Harness /></ReportDraftRecoveryProvider>
      </AuthSessionProvider>,
    );
    act(() => recovery.publishActive({ content: content("private draft"), reportId: "report-1", revision: 1 }));
    expect(recovery.hasActiveDraft).toBe(true);

    act(() => establishSession({ ...initialSession, csrfToken: "fresh-csrf" }));
    await waitFor(() => expect(recovery.hasActiveDraft).toBe(false));
  });
});
