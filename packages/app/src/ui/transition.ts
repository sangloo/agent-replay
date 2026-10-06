import { flushSync } from "react-dom";

/**
 * Apply a state change as one cross-fade of the whole page, where the
 * browser can and the reader has not asked for less motion; otherwise just
 * apply it. The change is flushed inside the transition, so the new state
 * is what the browser captures as "after".
 */
export function withTransition(update: () => void): void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}
