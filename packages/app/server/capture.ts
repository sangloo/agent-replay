/**
 * A session on this machine → a replay, with git supplying the two ends.
 *
 * The base is where HEAD pointed when the session started; the end is the
 * working tree now (or a named commit, for a session captured after the
 * fact). Everything between comes from the transcript, and everything the
 * transcript cannot explain is reconciled against those two ends by
 * `@agent-replay/core`'s capture.
 */

import { realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve as resolvePath, sep } from "node:path";

import {
  capture,
  isLockfile,
  parseTranscript,
  type Replay,
  type Transcript,
} from "@agent-replay/core";

import * as git from "./git.ts";
import { loadTranscripts, type SessionSummary } from "./sessions.ts";
import { findSaved, readReplay } from "./store.ts";

export interface CaptureRequest {
  session: SessionSummary;
  /** The repository; guessed from the session when omitted. */
  root?: string;
  /** Override the base commit. */
  base?: string;
  /** Read the end state from this commit instead of the working tree. */
  end?: string;
  thinking?: boolean;
  /** Replaces the first prompt as the title; a saved title otherwise survives. */
  title?: string;
}

export interface Captured {
  replay: Replay;
  root: string;
  /** Things the person should know about how faithful this replay is. */
  warnings: string[];
}

function inside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && rel !== "..");
}

/**
 * The repository a session worked in: the one containing its directory, or
 * — for a session started above several checkouts — the one whose files it
 * changed most.
 */
export function guessRoot(
  transcripts: readonly Transcript[],
  candidates: readonly string[],
): string | undefined {
  const cwd = transcripts[0]?.cwd;
  if (cwd) {
    const own = git.repoRoot(cwd);
    if (own) return own;
  }
  const counts = new Map<string, number>();
  for (const transcript of transcripts) {
    for (const event of transcript.events) {
      if (event.type !== "action") continue;
      const files = event.actions.flatMap((action) =>
        action.kind === "command"
          ? []
          : action.kind === "patch"
            ? action.files.map((file) => file.path)
            : [action.path],
      );
      for (const file of files) {
        const root =
          candidates.find((candidate) => inside(file, candidate)) ??
          git.repoRoot(resolvePath(file, ".."));
        if (root) counts.set(root, (counts.get(root) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Other absolute spellings of `root` the logs may use. Git answers with the
 * real path; an agent started under a symlink (`/tmp` → `/private/tmp` on
 * macOS, a linked `~/code`) records the path it was given.
 */
export function rootAliases(
  root: string,
  cwds: readonly (string | undefined)[],
): string[] {
  const aliases = new Set<string>();
  for (const cwd of cwds) {
    if (!cwd) continue;
    let real: string;
    try {
      real = realpathSync(cwd);
    } catch {
      continue;
    }
    const rel = relative(root, real);
    if (rel.startsWith("..") || isAbsolute(rel)) continue;
    const alias = rel ? resolvePath(cwd, ...rel.split(sep).map(() => "..")) : cwd;
    if (alias !== root) aliases.add(alias);
  }
  return [...aliases];
}

/** Every repo-relative path a session's actions name. */
function touchedPaths(
  transcripts: readonly Transcript[],
  roots: readonly string[],
): string[] {
  const paths = new Set<string>();
  const add = (file: string | undefined) => {
    if (!file) return;
    for (const root of roots) {
      if (inside(file, root)) {
        const rel = relative(root, file).split(sep).join("/");
        if (rel) paths.add(rel);
        return;
      }
    }
  };
  for (const transcript of transcripts) {
    for (const event of transcript.events) {
      if (event.type !== "action") continue;
      for (const action of event.actions) {
        if (action.kind === "command") continue;
        if (action.kind === "patch") {
          for (const file of action.files) {
            add(file.path);
            if (file.op === "update") add(file.moveTo);
          }
        } else add(action.path);
      }
    }
  }
  return [...paths];
}

export function captureSession(
  request: CaptureRequest,
  candidates: readonly string[] = [],
): Captured {
  const transcripts = loadTranscripts(request.session);
  const main = transcripts[0] ?? parseTranscript("");
  const root = request.root
    ? (git.repoRoot(request.root) ?? request.root)
    : guessRoot(transcripts, candidates);
  if (!root) {
    throw new Error(
      `Could not tell which repository session ${request.session.id} worked in. Pass --repo.`,
    );
  }
  const warnings: string[] = [];
  const isRepo = git.repoRoot(root) !== undefined;
  // A repository with no commits yet still has a working tree to compare.
  const hasCommits = isRepo && git.head(root) !== undefined;
  const base = request.base
    ? git.resolve(root, request.base)
    : hasCommits && main.startedAt
      ? git.headAt(root, main.startedAt)
      : undefined;
  const end = request.end ? git.resolve(root, request.end) : undefined;
  if (!isRepo)
    warnings.push(`${root} is not a git repository: no base, no reconciliation.`);
  if (request.base && !base) warnings.push(`Unknown base ${request.base}.`);
  if (request.end && !end) warnings.push(`Unknown end ${request.end}.`);

  const saved = findSaved(root, main.sessionId ?? request.session.id);
  const previous = saved ? readReplay(root, saved) : undefined;
  const head = end ?? git.head(root);

  const aliases = rootAliases(
    root,
    transcripts.flatMap((t) => [
      t.cwd,
      ...t.events.map((e) => (e.type === "action" ? e.cwd : undefined)),
    ]),
  );
  const touched = touchedPaths(transcripts, [root, ...aliases]);
  // Files a merge brought in (main merged into the branch mid-session) are
  // not the session's work unless the session touched them too.
  const merged =
    base && head ? git.mergedIn(root, base, head, !end) : new Set<string>();
  const mine = new Set(touched);
  const changed = (base ? git.changedFiles(root, base, end) : []).filter(
    (path) => !merged.has(path) || mine.has(path),
  );
  const paths = [...new Set([...touched, ...changed])];
  // One git process for every base file, not two per file: the hook runs
  // this after every turn.
  const bases = base
    ? git.readBlobs(
        root,
        paths.map((path) => `${base}:${path}`),
      )
    : new Map();
  const secret = isRepo ? git.ignored(root, paths) : new Set<string>();

  const replay = capture(transcripts, {
    root,
    aliases,
    repo: {
      name: basename(root),
      branch: main.branch ?? git.branch(root),
      base,
      end: head,
      dirty: end ? false : isRepo && git.isDirty(root),
      commits: base && head ? git.commitsBetween(root, base, head) : [],
    },
    readBase: base
      ? (path) => {
          const key = `${base}:${path}`;
          return bases.has(key)
            ? (bases.get(key) ?? null)
            : git.showFile(root, base, path);
        }
      : isRepo
        ? () => null
        : undefined,
    readFinal: isRepo
      ? end
        ? (path) => git.showFile(root, end, path)
        : (path) => git.readWorking(root, path)
      : undefined,
    changed,
    // Ignored files (`.env.local` and friends) are recorded as changed,
    // never stored: a replay is committed, and they are not.
    omit: (path) => isLockfile(path) || secret.has(path),
    thinking: request.thinking,
    title: request.title ?? previous?.title,
    notes: previous?.notes,
  });
  if (replay.steps.length === 0) warnings.push("The session has no steps.");
  return { replay, root, warnings };
}
