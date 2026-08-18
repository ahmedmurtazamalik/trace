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

export function useUnsavedNavigationGuard(dirty: boolean): {
  approveDestination: (url: string) => void;
  clearGuard: () => void;
} {
  const dirtyRef = useRef(dirty);
  const approvedDestinationRef = useRef<{ timeout: ReturnType<typeof setTimeout>; url: string }>();
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const clearGuard = useCallback(() => { dirtyRef.current = false; }, []);
  const approveDestination = useCallback((url: string) => {
    if (approvedDestinationRef.current) clearTimeout(approvedDestinationRef.current.timeout);
    const timeout = setTimeout(() => { approvedDestinationRef.current = undefined; }, 1000);
    approvedDestinationRef.current = { timeout, url };
  }, []);

  useEffect(() => {
    const navigation = navigationApi();
    if (!navigation) return;
    const guard = (rawEvent: Event) => {
      if (!dirtyRef.current) return;
      const event = rawEvent as NavigationEventLike;
      if (!event.canIntercept || event.downloadRequest !== null || event.hashChange) return;
      if (approvedDestinationRef.current?.url === event.destination.url) {
        clearTimeout(approvedDestinationRef.current.timeout);
        approvedDestinationRef.current = undefined;
        return;
      }
      if (!confirmDiscardUnsavedReportChanges(true)) event.preventDefault();
    };
    navigation.addEventListener("navigate", guard);
    return () => {
      navigation.removeEventListener("navigate", guard);
      if (approvedDestinationRef.current) clearTimeout(approvedDestinationRef.current.timeout);
      approvedDestinationRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (navigationApi()) return;
    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    let currentPoint = pointFrom(window.history.state) ?? 0;
    let restoringDeclinedTraversal = false;

    originalReplaceState(withPoint(window.history.state, currentPoint), "", window.location.href);
    window.history.pushState = (state, unused, url) => {
      currentPoint += 1;
      originalPushState(withPoint(state, currentPoint), unused, url);
    };
    window.history.replaceState = (state, unused, url) => {
      originalReplaceState(withPoint(state, currentPoint), unused, url);
    };

    const guardHistory = (event: PopStateEvent) => {
      const nextPoint = pointFrom(event.state);
      if (nextPoint === undefined) return;
      if (restoringDeclinedTraversal) {
        restoringDeclinedTraversal = false;
        currentPoint = nextPoint;
        event.stopImmediatePropagation();
        return;
      }
      if (dirtyRef.current && !confirmDiscardUnsavedReportChanges(true)) {
        const restoreDirection = nextPoint < currentPoint ? 1 : -1;
        restoringDeclinedTraversal = true;
        event.stopImmediatePropagation();
        window.history.go(restoreDirection);
        return;
      }
      currentPoint = nextPoint;
    };
    window.addEventListener("popstate", guardHistory, true);
    return () => {
      window.removeEventListener("popstate", guardHistory, true);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, []);

  return { approveDestination, clearGuard };
}
