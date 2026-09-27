/**
 * `replay course` — the tools a model uses to rebuild a repository from
 * nothing, as lessons, for someone learning it.
 *
 * The course is an ordinary replay file in `.replays/` (`source: "course"`),
 * appended to one step per command, so the player shows it at every moment
 * of its writing. Code only ever arrives from the target revision itself —
 * whole files, or chosen line ranges of them — so what the learner sees
 * being built is, character for character, the code that exists. Anything
 * written by hand is either an intermediate version of a real file or
 * clearly marked teaching material (`example`).
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  buildOrder,
  courseProgress,
  diffLines,
  editBetween,
  splitLines,
  isLockfile,
  play,
  REPLAY_DIR,
  REPLAY_VERSION,
  sliceLines,
  unstorable,
  type CourseProgress,
  type Replay,
  type Step,
} from "@agent-replay/core";

import * as git from "./git.ts";
import { readReplay, saveReplay } from "./store.ts";

/** Bigger or binary files are part of no lesson: they are listed, not taught. */
const MAX_BYTES = 512 * 1024;

export interface Target {
  rev: string;
  /** Every file the course arrives at, in build order. */
  files: Map<string, string>;
  /** Files in scope it leaves out: lockfiles, binaries, very large files. */
  skipped: string[];
}

function inScope(path: string, paths: readonly string[] | undefined): boolean {
  if (!paths?.length) return true;
  return paths.some((scope) => {
    const clean = scope.replace(/^\.\/|\/+$/g, "");
    return (
      clean === "" || clean === "." || path === clean || path.startsWith(`${clean}/`)
    );
  });
}

/** The files a course over `rev` (and `paths`) must arrive at. */
export function targetOf(root: string, rev: string, paths?: readonly string[]): Target {
  const all = git
    .filesAt(root, rev)
    .filter((path) => inScope(path, paths) && !path.startsWith(`${REPLAY_DIR}/`));
  const blobs = git.readBlobs(
    root,
    all.map((path) => `${rev}:${path}`),
  );
  const kept: { path: string; content: string }[] = [];
  const skipped: string[] = [];
  for (const path of all) {
    const content = blobs.get(`${rev}:${path}`) ?? null;
    if (content === null || unstorable(path, content, MAX_BYTES, isLockfile)) {
      skipped.push(path);
    } else kept.push({ path, content });
  }
  const byPath = new Map(kept.map((file) => [file.path, file.content]));
  const files = new Map(buildOrder(kept).map((path) => [path, byPath.get(path)!]));
  return { rev, files, skipped };
}

export interface Course {
  root: string;
  /** The saved file's name, without `.json`. */
  name: string;
  file: string;
  replay: Replay;
}

function stamp(): string {
  return new Date().toISOString();
}

let sequence = 0;
/** Unique within a course, and stable once written: notes are keyed by it. */
function stepId(kind: string): string {
  sequence += 1;
  return `${kind}-${Date.now().toString(36)}${sequence.toString(36)}`;
}

export function startCourse(
  root: string,
  options: { title: string; rev?: string; paths?: string[] },
): Course {
  const rev = git.resolve(root, options.rev ?? "HEAD");
  if (!rev) throw new Error(`Unknown revision ${options.rev ?? "HEAD"}.`);
  const now = stamp();
  const replay: Replay = {
    version: REPLAY_VERSION,
    id: `course:${rev.slice(0, 12)}:${Date.now().toString(36)}`,
    title: options.title,
    source: "course",
    startedAt: now,
    endedAt: now,
    repo: {
      name: root.split(/[\\/]/).filter(Boolean).at(-1) ?? "repository",
      branch: git.branch(root),
      end: rev,
      commits: [],
    },
    files: {},
    omitted: [],
    steps: [],
    notes: {},
    course: { rev, ...(options.paths?.length ? { paths: options.paths } : {}) },
  };
  const file = saveReplay(root, replay);
  return { root, name: nameOf(file), file, replay };
}

const nameOf = (file: string) =>
  file
    .split(/[\\/]/)
    .at(-1)!
    .replace(/\.json$/, "");

/** A course by file name, or the most recently written one in `root`. */
export function loadCourse(root: string, name?: string): Course {
  const dir = join(root, REPLAY_DIR);
  if (name) {
    const clean = nameOf(name);
    const replay = readReplay(root, clean);
    if (!replay || replay.source !== "course")
      throw new Error(`No course ${clean} in ${dir}.`);
    return { root, name: clean, file: join(dir, `${clean}.json`), replay };
  }
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((file) => file.endsWith(".json"));
  } catch {
    // No .replays yet.
  }
  const newest = names
    .map((file) => ({ file, mtime: statSync(join(dir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { file } of newest) {
    const replay = readReplay(root, nameOf(file));
    if (replay?.source === "course")
      return { root, name: nameOf(file), file: join(dir, file), replay };
  }
  throw new Error(
    "No course here yet — start one with `replay course start --title …`.",
  );
}

function save(course: Course): Course {
  course.replay.endedAt = stamp();
  const file = saveReplay(course.root, course.replay);
  return { ...course, file, name: nameOf(file) };
}

/** The lesson the next step belongs to: 0-based, -1 before the first. */
function lessonIndex(replay: Replay): number {
  return replay.steps.filter((step) => step.kind === "lesson").length - 1;
}

function append(course: Course, step: Step): Course {
  course.replay.steps.push(step);
  return save(course);
}

const base = (course: Course, kind: string, why?: string) => ({
  id: stepId(kind),
  at: stamp(),
  agent: "main",
  turn: lessonIndex(course.replay),
  ...(why ? { why } : {}),
});

/** Where the course stands for one file: its content after the last step. */
function current(course: Course, path: string): string | null {
  const playback = play(course.replay);
  return playback.contentAt(path, playback.length);
}

export function addLesson(course: Course, title: string, goal?: string): Course {
  const step: Step = {
    ...base(course, "lesson"),
    turn: lessonIndex(course.replay) + 1,
    kind: "lesson",
    title,
    ...(goal ? { goal } : {}),
  };
  return append(course, step);
}

/**
 * Where lines `a`–`b` of the target file are in the file as the course has
 * built it so far — the numbers `outline` and `take` use, translated. Every
 * one of them must be there already.
 */
export function mapLines(
  built: string,
  target: string,
  lines: [number, number],
): [number, number] {
  const have = splitLines(built);
  const want = splitLines(target).slice(lines[0] - 1, lines[1]);
  if (want.length !== lines[1] - lines[0] + 1) {
    throw new Error(`the target has no lines ${lines[0]}–${lines[1]}`);
  }
  // Where the diff says each target line sits in the built file.
  const place = new Map<number, number>();
  let b = 0;
  let t = 0;
  for (const op of diffLines(built, target)) {
    if (op === "=") place.set(++t, ++b);
    else if (op === "-") b++;
    else t++;
  }
  // The block as a whole, line for line: a brace or a blank line alone is
  // ambiguous to a diff, but a function is not. Of several matches, the one
  // nearest where the diff put it.
  const starts: number[] = [];
  for (let at = 0; at + want.length <= have.length; at++) {
    if (want.every((line, i) => have[at + i] === line)) starts.push(at + 1);
  }
  if (starts.length) {
    const hint = place.get(lines[0]) ?? starts[0]!;
    const start = starts.reduce((best, at) =>
      Math.abs(at - hint) < Math.abs(best - hint) ? at : best,
    );
    return [start, start + want.length - 1];
  }
  const missing: number[] = [];
  for (let line = lines[0]; line <= lines[1]; line++)
    if (!place.has(line)) missing.push(line);
  if (missing.length) {
    throw new Error(
      `lines ${missing.length > 3 ? `${missing[0]}–${missing.at(-1)}` : missing.join(", ")} of the target are not in the file yet — take them first`,
    );
  }
  return [place.get(lines[0])!, place.get(lines[1])!];
}

export function addExplain(
  course: Course,
  target: Target,
  text: string,
  about?: { path: string; lines?: [number, number] },
): Course {
  if (!text.trim()) throw new Error("An explanation needs some text.");
  let lines = about?.lines;
  if (about) {
    const content = current(course, about.path);
    if (content === null)
      throw new Error(`${about.path} does not exist yet at this point of the course.`);
    const final = target.files.get(about.path);
    // A real file's lines are counted as in the target — the numbers
    // `outline` shows and `take` uses; an example's, as it stands.
    if (lines && final !== undefined) lines = mapLines(content, final, lines);
    else if (lines) {
      const count = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
      if (lines[1] > count)
        throw new Error(
          `${about.path} has ${count} lines; --lines ${lines.join("-")} is past its end.`,
        );
    }
  }
  const step: Step = {
    ...base(course, "explain"),
    kind: "explain",
    text: text.trim(),
    ...(about ? { path: about.path } : {}),
    ...(lines ? { lines } : {}),
  };
  return append(course, step);
}

/** A file's next version: an edit when one replacement says it, else a write. */
function change(
  course: Course,
  path: string,
  after: string,
  meta: { why?: string; aside?: boolean },
): Course {
  const before = current(course, path);
  if (before === after)
    throw new Error(`${path} already reads exactly that — nothing to add.`);
  const edit = before === null ? undefined : editBetween(before, after);
  const common = {
    ...base(course, edit ? "edit" : "write", meta.why),
    path,
    ...(meta.aside ? { aside: true as const } : {}),
  };
  const step: Step = edit
    ? { ...common, kind: "edit", ...edit, replaceAll: false }
    : { ...common, kind: "write", content: after };
  return append(course, step);
}

/**
 * The next piece of a real file: those lines of it at the target revision
 * (or all of it). Growing the ranges step by step builds the file up in the
 * order that teaches it.
 */
export function take(
  course: Course,
  target: Target,
  path: string,
  ranges?: [number, number][],
  why?: string,
  options: { drop?: boolean } = {},
): Course {
  const content = target.files.get(path);
  if (content === undefined) {
    throw new Error(
      target.skipped.includes(path)
        ? `${path} is left out of courses (a lockfile, binary or over 512 KB).`
        : `${path} is not in the course's target — see \`replay course status\`.`,
    );
  }
  const total = splitLines(content).length;
  const past = ranges?.find(([, end]) => end > total);
  if (past) {
    throw new Error(
      `${path} has ${total} lines; --lines ${past[0]}-${past[1]} goes past its end.`,
    );
  }
  const after = ranges ? sliceLines(content, ranges) : content;
  // Taking a narrower range than before would take code away from the
  // learner, which is almost never what the author meant.
  const before = current(course, path);
  if (before !== null && !options.drop) {
    const kept = (text: string) => builtLines(text, content);
    const lost = [...kept(before)].filter((line) => !kept(after).has(line));
    if (lost.length) {
      throw new Error(
        `this would remove ${lost.length} line${lost.length === 1 ? "" : "s"} the learner has already seen (${rangesText(lost)}); widen --lines to keep them, or pass --drop to remove them on purpose.`,
      );
    }
  }
  return change(course, path, after, { why });
}

/** Which lines of `target` (by number) `built` already holds, in order. */
function builtLines(built: string, target: string): Set<number> {
  const have = new Set<number>();
  let t = 0;
  for (const op of diffLines(built, target)) {
    if (op === "=") have.add(++t);
    else if (op === "+") t++;
  }
  return have;
}

/** `[1,2,3,7]` → `"1–3, 7"`. */
export function rangesText(lines: readonly number[]): string {
  const parts: string[] = [];
  let start = lines[0];
  let last = lines[0];
  for (const line of [...lines.slice(1), Infinity]) {
    if (line === last! + 1) {
      last = line;
      continue;
    }
    parts.push(start === last ? `${start}` : `${start}–${last}`);
    start = line;
    last = line;
  }
  return parts.join(", ");
}

/** A version of a real file written by hand — a simpler first draft, say. */
export function write(
  course: Course,
  target: Target,
  path: string,
  content: string,
  why?: string,
): Course {
  if (!target.files.has(path)) {
    throw new Error(
      `${path} is not in the target. Teaching material goes in with \`replay course example\`.`,
    );
  }
  return change(course, path, content, { why });
}

/** Teaching material: an example, exercises, a worked note — not the repository. */
export function example(
  course: Course,
  target: Target,
  path: string,
  content: string,
  why?: string,
): Course {
  if (target.files.has(path) || target.skipped.includes(path)) {
    throw new Error(
      `${path} is a file of the repository itself; examples need a path of their own (learn/…).`,
    );
  }
  return change(course, path, content, { why, aside: true });
}

/**
 * A path pattern, as a person writes one: a directory or file matches itself
 * and everything under it; `*` stays within a folder, `**` crosses them; a
 * pattern with no `/` matches a file's name at any depth, as in .gitignore.
 */
export function globOf(pattern: string): (path: string) => boolean {
  const clean = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!/[*?]/.test(clean)) {
    return (path) => path === clean || path.startsWith(`${clean}/`);
  }
  let source = "";
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (c === "*" && clean[i + 1] === "*") {
      source += ".*";
      i += clean[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const regex = new RegExp(`^${source}$`);
  return clean.includes("/")
    ? (path) => regex.test(path)
    : (path) => regex.test(path.slice(path.lastIndexOf("/") + 1));
}

/** Bring every remaining matching file to its target, one step each. */
export function fill(
  course: Course,
  target: Target,
  patterns: readonly string[],
  why?: string,
): { course: Course; filled: string[] } {
  const globs = patterns.map(globOf);
  const match = (path: string) =>
    globs.length === 0 || globs.some((glob) => glob(path));
  const filled: string[] = [];
  let next = course;
  for (const [path, content] of target.files) {
    if (!match(path) || current(next, path) === content) continue;
    next = change(next, path, content, filled.length === 0 ? { why } : {});
    filled.push(path);
  }
  return { course: next, filled };
}

/** A step in a few words, for `show` and `undo`: what the author typed, not the format. */
export function describe(step: Step, index: number): string {
  const n = `#${index + 1}`.padStart(5);
  const first = (text: string) => {
    const line = text.trim().split("\n")[0] ?? "";
    return line.length > 70 ? `${line.slice(0, 69)}…` : line;
  };
  switch (step.kind) {
    case "lesson":
      return `${n}  lesson   "${step.title}"`;
    case "explain":
      return `${n}  explain  ${step.path ? `${step.path}${step.lines ? `:${step.lines[0]}-${step.lines[1]}` : ""}  ` : ""}"${first(step.text)}"`;
    case "write":
    case "edit":
      return `${n}  ${step.aside ? "example" : "code   "}  ${step.path}${step.why ? `  — ${first(step.why)}` : ""}`;
    case "delete":
      return `${n}  delete   ${step.path}`;
    default:
      return `${n}  ${step.kind}`;
  }
}

/**
 * Rewrite an explanation, a lesson's title or goal, or a step's `why` —
 * in place, keeping everything after it. Code steps change only by `undo`.
 */
export function amend(
  course: Course,
  number: number,
  change: { text?: string; title?: string; goal?: string; why?: string },
): Course {
  const step = course.replay.steps[number - 1];
  if (!step)
    throw new Error(
      `There is no step #${number} (the course has ${course.replay.steps.length}).`,
    );
  if (change.text !== undefined) {
    if (step.kind !== "explain")
      throw new Error(`#${number} is a ${step.kind}, not an explanation.`);
    if (!change.text.trim()) throw new Error("An explanation needs some text.");
    step.text = change.text.trim();
  }
  if (change.title !== undefined || change.goal !== undefined) {
    if (step.kind !== "lesson")
      throw new Error(`#${number} is a ${step.kind}, not a lesson.`);
    if (change.title !== undefined) step.title = change.title;
    if (change.goal !== undefined) step.goal = change.goal;
  }
  if (change.why !== undefined) step.why = change.why;
  return save(course);
}

/** Take back the last step (or the last `count`). */
export function undo(course: Course, count = 1): { course: Course; removed: Step[] } {
  const removed = course.replay.steps.splice(-count, count);
  return { course: save(course), removed };
}

export function progressOf(course: Course, target: Target): CourseProgress {
  return courseProgress(course.replay, target.files);
}

/** The target recorded in a course, read from git again. */
export function courseTarget(course: Course): Target {
  const target = course.replay.course;
  if (!target) throw new Error("Not a course.");
  return targetOf(course.root, target.rev, target.paths);
}
