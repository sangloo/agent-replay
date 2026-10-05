/**
 * Replay → any moment of it.
 *
 * A cursor counts steps applied, the way the player's timeline does: `0` is the
 * base commit, `steps.length` is the end of the session. Every file's
 * versions are computed once, up front, so moving the cursor anywhere —
 * scrubbing backwards included — is a lookup rather than a re-run.
 *
 * What costs a diff is left until someone asks: a change's hunks and line
 * counts, the session's totals, its coverage. A long session has thousands
 * of changes and a player shows one at a time, so opening it is the cost of
 * applying its steps, not of diffing every version of every file.
 */

import { applyStep, stepHunks } from "./apply.ts";
import { countLines, diffHunks, diffLines, splitLines, type Hunk } from "./diff.ts";
import { isChange, type ChangeStep, type Replay, type Step } from "./format.ts";

export interface Change {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
  /** Where `before` becomes `after`, in `before`'s coordinates. Computed when first read. */
  readonly hunks: Hunk[];
  /** False when the step could not be applied — the file is left as it was. */
  readonly applied: boolean;
  /** Lines in and out, as git counts them. Computed when first read. */
  readonly added: number;
  readonly removed: number;
}

/** A change whose hunks and counts are worked out the first time they are read. */
function lazyChange(
  step: ChangeStep,
  before: string | null,
  after: string | null,
  applied: boolean,
): Change {
  let hunks: Hunk[] | undefined;
  let counts: { added: number; removed: number } | undefined;
  const hunksOf = () => (hunks ??= applied ? stepHunks(before, step) : []);
  const countsOf = () => (counts ??= countLines(hunksOf(), before ?? ""));
  return {
    path: step.path,
    before,
    after,
    applied,
    get hunks() {
      return hunksOf();
    },
    get added() {
      return countsOf().added;
    },
    get removed() {
      return countsOf().removed;
    },
  };
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
  /** The net change from base to end. Computed when first read. */
  readonly totals: { added: number; removed: number; files: number };
}

interface Version {
  cursor: number;
  content: string | null;
}

export function play(replay: Replay): Playback {
  const versions = new Map<string, Version[]>();
  const current = new Map<string, string | null>();
  for (const [path, content] of Object.entries(replay.files)) {
    versions.set(path, [{ cursor: 0, content }]);
    current.set(path, content);
  }

  const frames: Frame[] = replay.steps.map((step, index) => {
    if (!isChange(step)) return { index, step };
    const before = current.get(step.path) ?? null;
    const next = applyStep(before, step);
    const applied = next !== undefined;
    const after = applied ? next : before;
    current.set(step.path, after);
    const list = versions.get(step.path) ?? [{ cursor: 0, content: null }];
    list.push({ cursor: index + 1, content: after });
    versions.set(step.path, list);
    return { index, step, change: lazyChange(step, before, after, applied) };
  });

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

  // Coverage needs every file's blame at the end: worked out once, on the
  // first question, then each answer is a count of the lines written before
  // the cursor — a binary search.
  let ready: { totalFiles: number; totalLines: number; steps: Int32Array } | undefined;
  const coverageAt = (cursor: number): Coverage => {
    if (!ready) {
      const ends = paths.filter(
        (path) => !asides.has(path) && contentAt(path, frames.length) !== null,
      );
      const steps = ends.flatMap((path) => blameAt(path, frames.length));
      ready = {
        totalFiles: ends.length,
        totalLines: steps.length,
        steps: Int32Array.from(steps).sort(),
      };
    }
    let files = 0;
    for (const path of paths) {
      if (asides.has(path) || contentAt(path, frames.length) === null) continue;
      if (contentAt(path, cursor) !== null) files++;
    }
    // A line counts once it holds its end-state text — once the step that
    // last wrote it, by the end's blame, has been applied.
    let lo = 0;
    let hi = ready.steps.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ready.steps[mid]! < cursor) lo = mid + 1;
      else hi = mid;
    }
    return {
      files,
      totalFiles: ready.totalFiles,
      lines: lo,
      totalLines: ready.totalLines,
    };
  };

  let totals: Playback["totals"] | undefined;
  const totalsOf = (): Playback["totals"] => {
    if (totals) return totals;
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
    }
    const files = paths.filter(
      (path) =>
        !asides.has(path) &&
        (contentAt(path, 0) !== contentAt(path, frames.length) ||
          (omitted.has(path) && versions.get(path)!.length > 1)),
    ).length;
    totals = { added, removed, files };
    return totals;
  };

  return {
    replay,
    frames,
    length: frames.length,
    contentAt,
    filesAt,
    focusAt,
    blameAt,
    coverageAt,
    get totals() {
      return totalsOf();
    },
  };
}
