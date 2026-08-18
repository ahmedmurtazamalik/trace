import { useEffect, useRef } from "react";

export const UNSAVED_REPORT_MESSAGE = "You have unsaved report changes. Discard them and leave this page?";
const HISTORY_POINT = "__traceUnsavedNavigationPoint";

interface NavigationEventLike extends Event {
  canIntercept: boolean;
  downloadRequest: string | null;
  hashChange: boolean;
}

type NavigationLike = EventTarget;
type PointState = Record<string, unknown> & { [HISTORY_POINT]: number };

let approvedNavigations = 0;

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

export function approveNextUnsavedNavigation(): void {
  approvedNavigations += 1;
}

export function browserGuardsUnsavedNavigation(): boolean {
  return navigationApi() !== undefined;
}

export function useUnsavedNavigationGuard(dirty: boolean): void {
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  useEffect(() => {
    const navigation = navigationApi();
    if (!navigation) return;
    const guard = (rawEvent: Event) => {
      if (!dirtyRef.current) return;
      const event = rawEvent as NavigationEventLike;
      if (!event.canIntercept || event.downloadRequest !== null || event.hashChange) return;
      if (approvedNavigations > 0) {
        approvedNavigations -= 1;
        return;
      }
      if (!confirmDiscardUnsavedReportChanges(true)) event.preventDefault();
    };
    navigation.addEventListener("navigate", guard);
    return () => navigation.removeEventListener("navigate", guard);
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
}
