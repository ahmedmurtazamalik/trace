import { useCallback, useEffect, useRef } from "react";

export const UNSAVED_REPORT_MESSAGE = "You have unsaved report changes. Discard them and leave this page?";
const HISTORY_POINT = "__traceUnsavedNavigationPoint";

interface NavigationEventLike extends Event {
  canIntercept: boolean;
  destination: { url: string };
  downloadRequest: string | null;
  hashChange: boolean;
}

type NavigationLike = EventTarget;
type PointState = Record<string, unknown> & { [HISTORY_POINT]: number };

function navigationApi(): NavigationLike | undefined {
  return (window as Window & { navigation?: NavigationLike }).navigation;
}

function withPoint(state: unknown, point: number): PointState {
  const record = typeof state === "object" && state !== null ? state as Record<string, unknown> : {};
  return { ...record, [HISTORY_POINT]: point } as PointState;
}

function pointFrom(state: unknown): number | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const point = (state as Record<string, unknown>)[HISTORY_POINT];
  return typeof point === "number" && Number.isFinite(point) ? point : undefined;
}

export function confirmDiscardUnsavedReportChanges(dirty: boolean): boolean {
  return !dirty || window.confirm(UNSAVED_REPORT_MESSAGE);
}

export function useUnsavedNavigationGuard(
  dirty: boolean,
  preserveDraftForRecovery: (url: string) => void,
  clearDraftRecovery: () => void,
  restoreDraftAfterTraversal: () => void,
): {
  clearGuard: () => void;
} {
  const dirtyRef = useRef(dirty);
  const dirtyEntryRef = useRef<{ point?: number; state: unknown; url: string }>();
  useEffect(() => {
    dirtyRef.current = dirty;
    dirtyEntryRef.current = dirty
      ? { point: pointFrom(window.history.state), state: window.history.state, url: window.location.href }
      : undefined;
  }, [dirty]);
  const clearGuard = useCallback(() => { dirtyRef.current = false; }, []);

  useEffect(() => {
    const navigation = navigationApi();
    if (!navigation) return;
    const guard = (rawEvent: Event) => {
      if (!dirtyRef.current) return;
      const event = rawEvent as NavigationEventLike;
      if (!event.canIntercept || event.downloadRequest !== null || event.hashChange) return;
      if (!confirmDiscardUnsavedReportChanges(true)) event.preventDefault();
      else {
        dirtyRef.current = false;
        clearDraftRecovery();
      }
    };
    navigation.addEventListener("navigate", guard);
    return () => navigation.removeEventListener("navigate", guard);
  }, [clearDraftRecovery]);

  useEffect(() => {
    if (navigationApi()) return;
    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    let currentPoint = pointFrom(window.history.state) ?? 0;
    let currentState = withPoint(window.history.state, currentPoint);
    let currentUrl = window.location.href;
    let restoringDeclinedTraversal: { expectedPoint: number; timeout: ReturnType<typeof setTimeout> } | undefined;

    const clearRestoration = () => {
      if (restoringDeclinedTraversal) clearTimeout(restoringDeclinedTraversal.timeout);
      restoringDeclinedTraversal = undefined;
    };
    const expectRestoration = (expectedPoint: number) => {
      clearRestoration();
      const timeout = setTimeout(clearRestoration, 1000);
      restoringDeclinedTraversal = { expectedPoint, timeout };
    };

    originalReplaceState(currentState, "", currentUrl);
    window.history.pushState = (state, unused, url) => {
      currentPoint += 1;
      currentState = withPoint(state, currentPoint);
      originalPushState(currentState, unused, url);
      currentUrl = window.location.href;
      if (
        dirtyRef.current
        && dirtyEntryRef.current
        && new URL(currentUrl).pathname === new URL(dirtyEntryRef.current.url).pathname
      ) dirtyEntryRef.current = { point: currentPoint, state: currentState, url: currentUrl };
    };
    window.history.replaceState = (state, unused, url) => {
      currentState = withPoint(state, currentPoint);
      originalReplaceState(currentState, unused, url);
      currentUrl = window.location.href;
      if (
        dirtyRef.current
        && dirtyEntryRef.current
        && new URL(currentUrl).pathname === new URL(dirtyEntryRef.current.url).pathname
      ) dirtyEntryRef.current = { point: currentPoint, state: currentState, url: currentUrl };
    };

    const guardHistory = (event: PopStateEvent) => {
      const nextPoint = pointFrom(event.state);
      if (restoringDeclinedTraversal && nextPoint === restoringDeclinedTraversal.expectedPoint) {
        clearRestoration();
        currentPoint = nextPoint;
        currentState = withPoint(event.state, currentPoint);
        currentUrl = window.location.href;
        return;
      }
      clearRestoration();
      if (dirtyRef.current) {
        const dirtyEntry = dirtyEntryRef.current;
        const sourcePoint = dirtyEntry?.point ?? currentPoint;
        const sourceState = dirtyEntry?.state ?? currentState;
        const sourceUrl = dirtyEntry?.url ?? currentUrl;
        preserveDraftForRecovery(sourceUrl);
        if (!confirmDiscardUnsavedReportChanges(true)) {
          event.stopImmediatePropagation();
          if (nextPoint === undefined) {
            originalPushState(sourceState, "", sourceUrl);
            expectRestoration(sourcePoint);
            window.dispatchEvent(new PopStateEvent("popstate", { state: sourceState }));
          } else {
            expectRestoration(sourcePoint);
            window.history.go(sourcePoint - nextPoint);
          }
          restoreDraftAfterTraversal();
          return;
        }
        clearDraftRecovery();
        dirtyRef.current = false;
      }
      if (nextPoint === undefined) {
        currentPoint = 0;
        currentState = withPoint(event.state, currentPoint);
        originalReplaceState(currentState, "", window.location.href);
      } else {
        currentPoint = nextPoint;
        currentState = withPoint(event.state, currentPoint);
      }
      currentUrl = window.location.href;
    };
    window.addEventListener("popstate", guardHistory, true);
    return () => {
      clearRestoration();
      window.removeEventListener("popstate", guardHistory, true);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, [clearDraftRecovery, preserveDraftForRecovery, restoreDraftAfterTraversal]);

  return { clearGuard };
}
