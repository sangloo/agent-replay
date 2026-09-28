/** Exact course-source references. No repository access or inferred line matching. */
import { applyStep } from "./apply.ts";
import { splitLines } from "./diff.ts";
import { isChange, type Replay, type SourceRange } from "./format.ts";

export interface SourceReference {
  path: string;
  lines: [number, number];
}
export interface SourceDestination extends SourceReference {
  cursor: number;
  displayed: [number, number];
  preview: string;
}
export type SourceResolution = { destination: SourceDestination } | { reason: string };

export function parseSourceReference(href: string): SourceReference | undefined {
  const match = /^source:([^?#]+)#L([1-9]\d*)(?:-L?([1-9]\d*))?$/.exec(href);
  if (!match) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(match[1]!);
  } catch {
    return undefined;
  }
  if (
    !path ||
    /[\\:#?]/.test(path) ||
    [...path].some((char) => char.charCodeAt(0) <= 32) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return undefined;
  const start = Number(match[2]),
    end = Number(match[3] ?? match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start)
    return undefined;
  return { path, lines: [start, end] };
}

/** Mapping entries describe every displayed line, sorted in original order. */
export function validSourceRanges(
  ranges: unknown,
  total: number,
  displayedLines: number,
): ranges is SourceRange[] {
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    !Array.isArray(ranges) ||
    !ranges.length
  )
    return false;
  let previous = 0,
    count = 0;
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 2) return false;
    const [start, end] = range;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start <= previous ||
      end < start ||
      end > total
    )
      return false;
    count += end - start + 1;
    previous = end;
  }
  return count === displayedLines;
}

export function mapSourceRange(
  ranges: readonly SourceRange[],
  wanted: [number, number],
): [number, number] | undefined {
  let offset = 0,
    first: number | undefined,
    last = 0,
    covered = 0;
  for (const [start, end] of ranges) {
    const a = Math.max(start, wanted[0]),
      b = Math.min(end, wanted[1]);
    if (a <= b) {
      first ??= offset + a - start + 1;
      last = offset + b - start + 1;
      covered += b - a + 1;
    }
    offset += end - start + 1;
  }
  return first !== undefined && covered === wanted[1] - wanted[0] + 1
    ? [first, last]
    : undefined;
}

interface Snapshot {
  cursor: number;
  content: string | null;
  ranges?: SourceRange[];
  explained: Set<number>;
}
export function sourceReferenceIndex(replay: Replay) {
  const snapshots = new Map<string, Snapshot[]>();
  const content = new Map(Object.entries(replay.files));
  for (const [index, step] of replay.steps.entries()) {
    if (!isChange(step)) continue;
    const next = applyStep(content.get(step.path) ?? null, step);
    if (next === undefined) continue;
    content.set(step.path, next);
    const info = replay.course?.sources?.[step.path];
    const ranges =
      (step.kind === "write" || step.kind === "edit") &&
      !step.aside &&
      info &&
      next !== null &&
      validSourceRanges(step.sourceLines, info.lineCount, splitLines(next).length)
        ? step.sourceLines
        : undefined;
    const history = snapshots.get(step.path) ?? [];
    const explained = new Set(history.at(-1)?.explained ?? []);
    const previousLines = new Set(
      (history.at(-1)?.ranges ?? []).flatMap(([a, b]) =>
        Array.from({ length: b - a + 1 }, (_, i) => a + i),
      ),
    );
    if (ranges && !("sourceMode" in step && step.sourceMode === "included")) {
      for (const [a, b] of ranges)
        for (let line = a; line <= b; line++)
          if (!previousLines.has(line)) explained.add(line);
    }
    history.push({
      cursor: index + 1,
      content: next,
      explained,
      ...(ranges ? { ranges } : {}),
    });
    snapshots.set(step.path, history);
  }
  function resolve(href: string, cursor: number): SourceResolution {
    const ref = parseSourceReference(href);
    if (!ref) return { reason: "Invalid source reference" };
    const info = replay.course?.sources?.[ref.path];
    if (!info)
      return { reason: "Original source mapping is unavailable in this replay" };
    if (ref.lines[1] > info.lineCount)
      return { reason: "Reference is beyond the pinned source file" };
    const history = snapshots.get(ref.path) ?? [];
    const current = history.filter((s) => s.cursor <= cursor).at(-1);
    const candidates = [
      ...(current ? [current] : []),
      ...history.filter((s) => s.cursor > cursor),
      ...history.filter((s) => s !== current && s.cursor <= cursor).reverse(),
    ];
    for (const snapshot of candidates) {
      const displayed = snapshot.ranges && mapSourceRange(snapshot.ranges, ref.lines);
      if (!displayed || snapshot.content === null) continue;
      const preview = splitLines(snapshot.content)
        .slice(displayed[0] - 1, Math.min(displayed[1], displayed[0] + 11))
        .join("");
      return {
        destination: {
          ...ref,
          cursor: snapshot === current ? cursor : snapshot.cursor,
          displayed,
          preview,
        },
      };
    }
    return {
      reason: "These original lines are omitted or not fully included in this replay",
    };
  }
  function coverage(cursor: number) {
    const infos = replay.course?.sources;
    if (!infos) return undefined;
    const total = Object.values(infos).reduce(
      (sum, info) =>
        sum +
        (Number.isSafeInteger(info.lineCount) && info.lineCount >= 0
          ? info.lineCount
          : 0),
      0,
    );
    let shown = 0,
      explained = 0;
    for (const history of snapshots.values()) {
      const snapshot = history.filter((s) => s.cursor <= cursor).at(-1);
      if (snapshot?.ranges)
        for (const [a, b] of snapshot.ranges) {
          shown += b - a + 1;
          for (let line = a; line <= b; line++)
            if (snapshot.explained.has(line)) explained++;
        }
    }
    return { shown, total, explained, included: shown - explained };
  }
  return { resolve, coverage };
}
