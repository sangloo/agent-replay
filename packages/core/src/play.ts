/**
 * Replay → any moment of it.
 *
 * A cursor counts steps applied, the way the player's timeline does: `0` is the
 * base commit, `steps.length` is the end of the session. Every file's
 * versions are computed once, up front, so moving the cursor anywhere —
 * scrubbing backwards included — is a lookup rather than a re-run.
 */

import { applyStep, stepHunks } from "./apply.ts";
import { countLines, diffHunks, diffLines, splitLines, type Hunk } from "./diff.ts";
import { isChange, type Replay, type Step } from "./format.ts";

export interface Change {
  path: string;
  before: string | null;
  after: string | null;
  /** Where `before` becomes `after`, in `before`'s coordinates. */
  hunks: Hunk[];
  /** False when the step could not be applied — the file is left as it was. */
  applied: boolean;
  added: number;
  removed: number;
}

export interface Frame {
  index: number;
  step: Step;
  change?: Change;
}

export interface Coverage {
  files: number;
  totalFiles: number;
  lines: number;
  totalLines: number;
}

export type FileStatus = "added" | "modified" | "deleted" | "unchanged";

export interface FileEntry {
  path: string;
  status: FileStatus;
  /** A step at or before the cursor changed it. */
  touched: boolean;
  /** Its content was too large or binary to store. */
  omitted: boolean;
  /** The file does not exist at the cursor, and never did before it. */
  absent: boolean;
  /** Teaching material a course wrote, not part of the repository. */
  aside?: boolean;
}

export interface Playback {
  replay: Replay;
  frames: Frame[];
  length: number;
  contentAt(path: string, cursor: number): string | null;
  filesAt(cursor: number): FileEntry[];
  /** The file the most recent change at or before `cursor` touched. */
  focusAt(cursor: number): string | undefined;
  /**
   * For each line of `path` at `cursor`, the index of the step that last
   * wrote it — `-1` for a line as it was at the base commit.
   */
  blameAt(path: string, cursor: number): number[];
  /**
   * How much of the end state exists at `cursor`: files present, and lines
   * of those files — the "how far along" of a history replay.
   */
  coverageAt(cursor: number): Coverage;
  totals: { added: number; removed: number; files: number };
}

interface Version {
  cursor: number;
  content: string | null;
}

function* prepare(replay: Replay): Generator<number, Playback> {
  const versions = new Map<string, Version[]>();
  const current = new Map<string, string | null>();
  for (const [path, content] of Object.entries(replay.files)) {
    versions.set(path, [{ cursor: 0, content }]);
    current.set(path, content);
  }

  const frames: Frame[] = [];
  for (const [index, step] of replay.steps.entries()) {
    if (!isChange(step)) {
      frames.push({ index, step });
      yield index + 1;
      continue;
    }
    const before = current.get(step.path) ?? null;
    const next = applyStep(before, step);
    const applied = next !== undefined;
    const after = applied ? next : before;
    let cachedHunks: Hunk[] | undefined;
    let cachedCounts: { added: number; removed: number } | undefined;
    const hunks = () => (cachedHunks ??= applied ? stepHunks(before, step) : []);
    const counts = () => (cachedCounts ??= countLines(hunks(), before ?? ""));
    current.set(step.path, after);
    const list = versions.get(step.path) ?? [{ cursor: 0, content: null }];
    list.push({ cursor: index + 1, content: after });
    versions.set(step.path, list);
    frames.push({
      index,
      step,
      change: {
        path: step.path,
        before,
        after,
        get hunks() {
          return hunks();
        },
        applied,
        get added() {
          return counts().added;
        },
        get removed() {
          return counts().removed;
        },
      },
    });
    yield index + 1;
  }

  const contentAt = (path: string, cursor: number): string | null => {
    const list = versions.get(path);
    if (!list) return null;
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (list[mid]!.cursor <= cursor) lo = mid;
      else hi = mid - 1;
    }
    return list[lo]!.content;
  };

  const omitted = new Set(replay.omitted);
  const paths = [...versions.keys()].sort((a, b) => a.localeCompare(b));
  // A course's examples and notes: shown, but no part of what it rebuilds.
  const asides = new Set(
    replay.steps.flatMap((step) =>
      (step.kind === "write" || step.kind === "edit") && step.aside ? [step.path] : [],
    ),
  );

  const filesAt = (cursor: number): FileEntry[] =>
    paths.map((path) => {
      const list = versions.get(path)!;
      const base = list[0]!.content;
      const now = contentAt(path, cursor);
      const touched = list.some((v) => v.cursor > 0 && v.cursor <= cursor);
      // An omitted body is a placeholder, so equality says nothing about it:
      // whether a step touched it is the only evidence.
      const same = omitted.has(path) ? !touched : now === base;
      const status: FileStatus =
        base === null
          ? now === null
            ? "unchanged"
            : "added"
          : now === null
            ? "deleted"
            : same
              ? "unchanged"
              : "modified";
      return {
        path,
        status,
        touched,
        omitted: omitted.has(path),
        absent: base === null && now === null,
        ...(asides.has(path) ? { aside: true } : {}),
      };
    });

  const focusAt = (cursor: number): string | undefined => {
    for (let i = Math.min(cursor, frames.length) - 1; i >= 0; i--) {
      const change = frames[i]!.change;
      if (change) return change.path;
    }
    return undefined;
  };

  // Per path, the blame of each version, filled in as far as anyone asks.
  const blames = new Map<string, number[][]>();
  const blameAt = (path: string, cursor: number): number[] => {
    const list = versions.get(path);
    if (!list) return [];
    let known = blames.get(path);
    if (!known) {
      known = [splitLines(list[0]!.content ?? "").map(() => -1)];
      blames.set(path, known);
    }
    let upto = 0;
    while (upto + 1 < list.length && list[upto + 1]!.cursor <= cursor) upto++;
    for (let v = known.length; v <= upto; v++) {
      const step = list[v]!.cursor - 1;
      const previous = known[v - 1]!;
      const next: number[] = [];
      let line = 0;
      for (const op of diffLines(list[v - 1]!.content ?? "", list[v]!.content ?? "")) {
        if (op === "=") next.push(previous[line++] ?? -1);
        else if (op === "-") line++;
        else next.push(step);
      }
      known.push(next);
    }
    return known[upto]!;
  };

  const endLines = new Map<string, number>();
  for (const path of paths) {
    if (asides.has(path)) continue;
    const end = contentAt(path, frames.length);
    if (end !== null) endLines.set(path, splitLines(end).length);
  }
  const totalLines = [...endLines.values()].reduce((sum, n) => sum + n, 0);
  const coverageAt = (cursor: number): Coverage => {
    let files = 0;
    let lines = 0;
    for (const path of endLines.keys()) {
      if (contentAt(path, cursor) === null) continue;
      files++;
      // A line counts once it holds its end-state text — once the step that
      // last wrote it, by the end's blame, has been applied.
      lines += blameAt(path, frames.length).filter((step) => step < cursor).length;
    }
    return { files, totalFiles: endLines.size, lines, totalLines };
  };

  let added = 0;
  let removed = 0;
  for (const path of paths) {
    if (asides.has(path)) continue;
    const base = contentAt(path, 0);
    const end = contentAt(path, frames.length);
    if (base === end) continue;
    const net = countLines(diffHunks(base ?? "", end ?? ""), base ?? "");
    added += net.added;
    removed += net.removed;
    yield frames.length;
  }
  const changedFiles = paths.filter(
    (path) =>
      !asides.has(path) &&
      (contentAt(path, 0) !== contentAt(path, frames.length) ||
        (omitted.has(path) && versions.get(path)!.length > 1)),
  ).length;

  return {
    replay,
    frames,
    length: frames.length,
    contentAt,
    filesAt,
    focusAt,
    blameAt,
    coverageAt,
    totals: { added, removed, files: changedFiles },
  };
}

/** Synchronous API retained for CLI and small embedded sessions. */
export function play(replay: Replay): Playback {
  const iterator = prepare(replay);
  let result = iterator.next();
  while (!result.done) result = iterator.next();
  return result.value;
}

/** Cooperatively prepare long sessions without monopolizing the browser thread. */
export async function preparePlayback(
  replay: Replay,
  onProgress: (steps: number) => void,
  signal: AbortSignal,
): Promise<Playback> {
  const iterator = prepare(replay);
  let slice = performance.now();
  for (;;) {
    signal.throwIfAborted();
    const result = iterator.next();
    if (result.done) return result.value;
    if (performance.now() - slice >= 8) {
      onProgress(result.value);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      slice = performance.now();
    }
  }
}
