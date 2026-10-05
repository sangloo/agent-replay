/**
 * Progress kept beyond this browser: the local service holds a copy, so a
 * reader who comes back in another browser — or on another port — picks up
 * where they were. Browser storage stays the copy the player reads, at
 * once; this keeps the two in step, the newer entry winning either way.
 */

import * as React from "react";

import { api } from "./api";
import {
  adoptProgress,
  allProgress,
  onProgressSaved,
  type StudyProgress,
} from "./study-progress";

/** How long the first render waits for the service's copy before going on. */
const WAIT = 400;
/** Saves are sent together, at most this often. */
const BATCH = 1500;

/** Bumped when entries arrive from the service, so lists showing progress redraw. */
export const ProgressVersion = React.createContext(0);

/**
 * Bring this browser's progress and the service's together, then keep
 * sending what changes. `ready` once the service has answered, or after a
 * moment if it has not — a missing service is only a lost convenience.
 */
export function useProgressSync(): { ready: boolean; version: number } {
  const [ready, setReady] = React.useState(false);
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    const pending = new Map<string, StudyProgress>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = (closing = false) => {
      clearTimeout(timer);
      timer = undefined;
      if (!pending.size) return;
      const entries = Object.fromEntries(pending);
      pending.clear();
      void api.saveProgress(entries, closing);
    };
    const waited = setTimeout(() => alive && setReady(true), WAIT);
    void api.progress().then((result) => {
      if (!alive) return;
      if (result.ok) {
        const theirs = result.data;
        if (adoptProgress(theirs) > 0) setVersion((n) => n + 1);
        // What this browser knows that the service does not, or knows newer.
        for (const [key, mine] of Object.entries(allProgress())) {
          const known = theirs[key];
          if (!known || known.updatedAt < mine.updatedAt) pending.set(key, mine);
        }
        flush();
      }
      clearTimeout(waited);
      setReady(true);
    });
    const stop = onProgressSaved((key, progress) => {
      pending.set(key, progress);
      timer ??= setTimeout(flush, BATCH);
    });
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      alive = false;
      clearTimeout(waited);
      stop();
      window.removeEventListener("pagehide", onHide);
      flush(true);
    };
  }, []);
  return { ready, version };
}
