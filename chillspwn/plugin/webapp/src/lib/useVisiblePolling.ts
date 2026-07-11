import { useEffect, useRef } from "react";

/**
 * Polls `fn` every `intervalMs`, but SKIPS ticks while the tab/app is hidden
 * (phone screen locked, PWA backgrounded, another app in front) and fires once
 * immediately when it becomes visible again.
 *
 * Why: continuous background polling on the main thread is a real source of
 * mobile jank + battery drain — every tick is a network request plus a React
 * state update / re-render even when nobody is looking. Gating on
 * `document.hidden` stops that churn while hidden and gives the user fresh data
 * the instant they return.
 */
export function useVisiblePolling(fn: () => void, intervalMs: number) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    let stopped = false;
    saved.current(); // initial fetch on mount

    const tick = () => {
      if (!stopped && !document.hidden) saved.current();
    };
    const id = window.setInterval(tick, intervalMs);

    const onVisible = () => {
      if (!document.hidden) saved.current();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
