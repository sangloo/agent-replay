/**
 * Where a reader is in each replay, kept beside `projects.json` so it is the
 * same in every browser and on every port the player is opened on. The
 * player keeps its own copy in browser storage, for speed; this is what the
 * copies agree on. Only positions are kept — replay and lesson ids, step
 * numbers, done or not — never any of a replay's content.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configDir } from "./projects.ts";

export interface Progress {
  cursor: number;
  reviewed: boolean;
  updatedAt: number;
  furthest?: number;
  total?: number;
}

/** The keys the player writes: a lesson's or replay's progress, or a position. */
const KEY = /^replay:(study|position):[\w%.~*'()!-]{1,400}(:[\w%.~*'()!-]{0,200})?$/;
/** Entries kept at most; the least recently studied go first. */
const MAX = 5000;

export function progressFile(): string {
  return join(configDir(), "progress.json");
}

const count = (value: unknown) =>
  value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);

export function isProgress(value: unknown): value is Progress {
  if (!value || typeof value !== "object") return false;
  const p = value as Progress;
  return (
    Number.isSafeInteger(p.cursor) &&
    p.cursor >= 0 &&
    typeof p.reviewed === "boolean" &&
    Number.isFinite(p.updatedAt) &&
    count(p.furthest) &&
    count(p.total)
  );
}

/** Only well-formed entries under the player's keys, with only their known fields. */
export function cleanProgress(input: unknown): Record<string, Progress> {
  const out: Record<string, Progress> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    if (!KEY.test(key) || !isProgress(value)) continue;
    const { cursor, reviewed, updatedAt, furthest, total } = value;
    out[key] = {
      cursor,
      reviewed,
      updatedAt,
      ...(furthest === undefined ? {} : { furthest }),
      ...(total === undefined ? {} : { total }),
    };
  }
  return out;
}

export function readProgress(file = progressFile()): Record<string, Progress> {
  try {
    return cleanProgress(JSON.parse(readFileSync(file, "utf8")).progress);
  } catch {
    return {};
  }
}

/** Merge entries in, the newer of each pair winning; answers what is kept now. */
export function mergeProgress(
  entries: Record<string, Progress>,
  file = progressFile(),
): Record<string, Progress> {
  const all = readProgress(file);
  let changed = false;
  for (const [key, value] of Object.entries(entries)) {
    const known = all[key];
    if (known && known.updatedAt >= value.updatedAt) continue;
    all[key] = value;
    changed = true;
  }
  if (!changed) return all;
  const kept = Object.fromEntries(
    Object.entries(all)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX),
  );
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ progress: kept })}\n`);
  renameSync(temp, file);
  return kept;
}
