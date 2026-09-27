/**
 * Courses: a repository rebuilt from nothing, for someone learning it.
 *
 * A course is a replay (`source: "course"`) whose steps an author — usually
 * a model — writes on purpose: lessons, explanations, and the repository's
 * files arriving a piece at a time, each piece taken from the real file at
 * the target revision. This module is the arithmetic the authoring tools and
 * the player share: slicing a file by lines, outlining it, and measuring how
 * far a course has come towards its target.
 */

import { diffLines, splitLines } from "./diff.ts";
import type { Replay } from "./format.ts";
import { play } from "./play.ts";

/** `"1-20,45"` → `[[1, 20], [45, 45]]`; 1-based, inclusive. */
export function parseRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const part of text.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!match) throw new Error(`"${part.trim()}" is not a line range (try 12-40)`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start)
      throw new Error(`"${part.trim()}" is not a line range`);
    ranges.push([start, end]);
  }
  return ranges;
}

/**
 * The lines of `content` in `ranges`, in file order, each range once: a
 * piece of the real file, so a course never retypes — or misremembers —
 * the code it teaches.
 */
export function sliceLines(
  content: string,
  ranges: readonly [number, number][],
): string {
  const lines = splitLines(content);
  const keep = new Set<number>();
  for (const [start, end] of ranges) {
    if (start > lines.length) {
      throw new Error(`line ${start} is past the end (the file has ${lines.length})`);
    }
    for (let line = start; line <= Math.min(end, lines.length); line++) keep.add(line);
  }
  const out = [...keep].sort((a, b) => a - b).map((line) => lines[line - 1]!);
  const text = out.join("");
  // A slice that stops before the file's last line still ends its last line.
  return text && !text.endsWith("\n") ? `${text}\n` : text;
}

export interface CodeSymbol {
  name: string;
  kind: string;
  /** 1-based. */
  line: number;
  /** The definition's last line, as near as braces or indentation tell. */
  end: number;
  /** Where the comment or decorators just above it begin, when there are any. */
  doc?: number;
}

const STRINGS = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

/** The last line (0-based) of the definition starting at `start`. */
function blockEnd(lines: readonly string[], start: number): number {
  const head = lines[start]!;
  // Python: the body is whatever is indented deeper than the `def`.
  if (/^\s*(?:async\s+)?(?:def|class)\s/.test(head) && head.trimEnd().endsWith(":")) {
    const indent = head.search(/\S/);
    let end = start;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;
      if (line.search(/\S/) <= indent) break;
      end = i;
    }
    return end;
  }
  // Braces: until they close; a braceless one-liner ends at its `;`.
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i++) {
    const code = lines[i]!.replace(STRINGS, '""').replace(/\/\/.*$/, "");
    for (const char of code) {
      if (char === "{") {
        depth++;
        opened = true;
      } else if (char === "}") depth--;
    }
    if (opened && depth <= 0) return i;
    if (!opened && depth === 0 && /;\s*$/.test(code)) return i;
  }
  return lines.length - 1;
}

/** The first line (0-based) of the comment or decorators right above `start`. */
function docStart(lines: readonly string[], start: number): number | undefined {
  let at = start;
  while (at > 0 && /^\s*(\/\*\*?|\*|\/\/|#(?!!)|@\w)/.test(lines[at - 1]!)) at--;
  return at < start ? at : undefined;
}

const DEFINITIONS: readonly [string, RegExp][] = [
  [
    "class",
    /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  ],
  [
    "function",
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/,
  ],
  ["interface", /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/],
  ["type", /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/],
  ["enum", /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/],
  [
    "const",
    /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
  ],
  ["const", /^export\s+const\s+([A-Za-z_$][\w$]*)/],
  ["def", /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/],
  ["class", /^\s*class\s+([A-Za-z_]\w*)\s*[(:]/],
  ["func", /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/],
  ["type", /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/],
  ["fn", /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/],
  ["struct", /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/],
];

/** Where each definition starts: enough to choose line ranges by. */
export function outline(content: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = splitLines(content).map((line) => line.replace(/\n$/, ""));
  lines.forEach((text, index) => {
    for (const [kind, pattern] of DEFINITIONS) {
      const match = pattern.exec(text);
      if (match) {
        const doc = docStart(lines, index);
        symbols.push({
          name: match[1]!,
          kind,
          line: index + 1,
          end: blockEnd(lines, index) + 1,
          ...(doc === undefined ? {} : { doc: doc + 1 }),
        });
        break;
      }
    }
  });
  return symbols;
}

export type BuildStatus = "complete" | "partial" | "missing";

export interface FileProgress {
  path: string;
  status: BuildStatus;
  /** Lines of the target file already there, in place. */
  lines: number;
  totalLines: number;
}

export interface CourseProgress {
  files: FileProgress[];
  complete: number;
  partial: number;
  missing: number;
  lines: number;
  totalLines: number;
  /** Files the course made that the target does not have (asides aside). */
  extra: string[];
  lessons: number;
  steps: number;
}

/**
 * How far `replay` has come towards `target` — every file the course must
 * arrive at, by path, in the order it should be built.
 */
export function courseProgress(
  replay: Replay,
  target: ReadonlyMap<string, string>,
): CourseProgress {
  const playback = play(replay);
  const now = new Map(
    playback.filesAt(playback.length).map((file) => [file.path, file] as const),
  );
  const files: FileProgress[] = [];
  let lines = 0;
  let totalLines = 0;
  for (const [path, content] of target) {
    const current = playback.contentAt(path, playback.length);
    const total = splitLines(content).length;
    let have = 0;
    if (current === content) have = total;
    else if (current !== null) {
      // Target lines already present, in order.
      have = diffLines(current, content).filter((op) => op === "=").length;
    }
    lines += have;
    totalLines += total;
    files.push({
      path,
      status:
        current === content ? "complete" : current === null ? "missing" : "partial",
      lines: have,
      totalLines: total,
    });
  }
  const extra = [...now.values()]
    .filter(
      (file) =>
        !file.aside &&
        !target.has(file.path) &&
        playback.contentAt(file.path, playback.length) !== null,
    )
    .map((file) => file.path);
  const count = (status: BuildStatus) =>
    files.filter((f) => f.status === status).length;
  return {
    files,
    complete: count("complete"),
    partial: count("partial"),
    missing: count("missing"),
    lines,
    totalLines,
    extra,
    lessons: replay.steps.filter((step) => step.kind === "lesson").length,
    steps: replay.steps.length,
  };
}
