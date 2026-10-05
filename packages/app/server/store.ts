/**
 * Saved replays: `<repo>/.replays/*.json`, committed next to the code they
 * describe.
 *
 * One file per session, named so a directory listing reads as a log —
 * `2026-09-26-add-greeting-1f3a9c2e.json` — and found again by the session
 * id's prefix, so capturing the same session twice replaces the file rather
 * than adding a second.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { REPLAY_DIR, isChange, type Replay } from "@agent-replay/core";

export interface SavedReplay {
  /** The file name without `.json`. */
  name: string;
  file: string;
  id: string;
  agent: string;
  title: string;
  startedAt: string;
  endedAt: string;
  steps: number;
  changes: number;
  notes: number;
  /** A course's lessons; absent on anything else. */
  lessons?: number;
  /** The revision its steps arrive at: a course's target, else the end commit. */
  revision?: string;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "session"
  );
}

/**
 * Eight characters that tell one replay's file from another's: a hash of
 * the whole id. Not a prefix — UUIDv7 ids (Codex's) share their first eight
 * characters for a minute at a time, so a prefix would let one session's
 * capture replace another's.
 */
export function idKey(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function replayName(replay: Replay): string {
  const date = (replay.startedAt || new Date().toISOString()).slice(0, 10);
  return `${date}-${slug(replay.title)}-${idKey(replay.id)}`;
}

function names(root: string): string[] {
  try {
    return readdirSync(join(root, REPLAY_DIR))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length));
  } catch {
    return [];
  }
}

/**
 * The saved replay of a session, if there is one — confirmed by the id
 * inside the file, never by the name alone. Files named before ids were
 * hashed (by the id's first eight characters) are still found.
 */
export function findSaved(root: string, id: string): string | undefined {
  const suffixes = [`-${idKey(id)}`, `-${id.slice(0, 8)}`];
  return names(root).find(
    (name) =>
      suffixes.some((suffix) => name.endsWith(suffix)) &&
      readReplay(root, name)?.id === id,
  );
}

export function readReplay(root: string, name: string): Replay | undefined {
  if (!/^[\w.-]+$/.test(name)) return undefined;
  try {
    return JSON.parse(
      readFileSync(join(root, REPLAY_DIR, `${name}.json`), "utf8"),
    ) as Replay;
  } catch {
    return undefined;
  }
}

/** Write atomically, replacing any earlier capture of the same session. */
export function saveReplay(root: string, replay: Replay): string {
  const dir = join(root, REPLAY_DIR);
  mkdirSync(dir, { recursive: true });
  const name = replayName(replay);
  const previous = findSaved(root, replay.id);
  const file = join(dir, `${name}.json`);
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(replay, null, 1)}\n`);
  renameSync(temp, file);
  if (previous && previous !== name)
    rmSync(join(dir, `${previous}.json`), { force: true });
  return file;
}

// A listing reads every saved replay, and a replay can run to megabytes:
// each file's summary is kept until the file changes.
const summaries = new Map<string, { stamp: string; saved: SavedReplay | undefined }>();

function summarize(root: string, name: string): SavedReplay | undefined {
  const file = join(root, REPLAY_DIR, `${name}.json`);
  let stamp: string;
  try {
    const stats = statSync(file);
    stamp = `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return undefined;
  }
  const cached = summaries.get(file);
  if (cached?.stamp === stamp) return cached.saved;
  const replay = readReplay(root, name);
  const saved = replay && {
    name,
    file,
    id: replay.id,
    agent: replay.source,
    title: replay.title,
    startedAt: replay.startedAt,
    endedAt: replay.endedAt,
    steps: replay.steps.length,
    changes: replay.steps.filter(isChange).length,
    notes: Object.keys(replay.notes).length,
    ...((replay.course?.rev ?? replay.repo.end)
      ? { revision: replay.course?.rev ?? replay.repo.end }
      : {}),
    ...(replay.source === "course"
      ? { lessons: replay.steps.filter((step) => step.kind === "lesson").length }
      : {}),
  };
  summaries.set(file, { stamp, saved });
  return saved;
}

export function listSaved(root: string): SavedReplay[] {
  return names(root)
    .map((name) => summarize(root, name))
    .filter((saved): saved is SavedReplay => saved !== undefined)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
