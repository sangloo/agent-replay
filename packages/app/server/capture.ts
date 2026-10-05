/**
 * A session on this machine → a replay, with git supplying the two ends.
 *
 * The base is where HEAD pointed when the session started; the end is the
 * working tree now (or a named commit, for a session captured after the
 * fact). Everything between comes from the transcript, and everything the
 * transcript cannot explain is reconciled against those two ends by
 * `@agent-replay/core`'s capture.
 */

import { realpathSync, statSync } from "node:fs";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";

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
  onProgress?: (message: string) => void;
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
 * `git.repoRoot`, asked once per directory: every answer is a git process,
 * and a capture asks about the same directories again — each file's in a
 * session started above several checkouts, and the root it settles on.
 */
export function repoRoots(): (dir: string) => string | undefined {
  const known = new Map<string, string | undefined>();
  return (dir) => {
    if (!known.has(dir)) {
      const top = git.repoRoot(dir);
      known.set(dir, top);
      // A repository's top level is its own.
      if (top) known.set(top, top);
    }
    return known.get(dir);
  };
}

/**
 * The repository a session worked in: the one containing its directory, or
 * — for a session started above several checkouts — the one whose files it
 * changed most.
 */
export function guessRoot(
  transcripts: readonly Transcript[],
  candidates: readonly string[],
  repoRoot: (dir: string) => string | undefined = repoRoots(),
): string | undefined {
  const cwd = transcripts[0]?.cwd;
  if (cwd) {
    const own = repoRoot(cwd);
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
          repoRoot(resolvePath(file, ".."));
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

/** When a working file was last written, as an ISO time; nothing once it is gone. */
function modifiedAt(root: string, path: string): string | undefined {
  try {
    return statSync(join(root, path)).mtime.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Git is asked in four rounds, each round's questions at once: the
 * repository; then HEAD, where it stood when the session started, and the
 * branch's reflog; then everything that needs only the base — the untracked
 * walk, the diff, the base tree, the index, the commits since; then the
 * file bodies and ignore checks, which need the paths those found.
 */
export async function captureSession(
  request: CaptureRequest,
  candidates: readonly string[] = [],
): Promise<Captured> {
  request.onProgress?.("Reading transcript");
  const transcripts = loadTranscripts(request.session);
  request.onProgress?.("Resolving repository history");
  const main = transcripts[0] ?? parseTranscript("");
  const repoRoot = repoRoots();
  const root = request.root
    ? (repoRoot(request.root) ?? request.root)
    : guessRoot(transcripts, candidates, repoRoot);
  if (!root) {
    throw new Error(
      `Could not tell which repository session ${request.session.id} worked in. Pass --repo.`,
    );
  }
  const warnings: string[] = [];
  const unsupported = transcripts.reduce(
    (sum, transcript) => sum + (transcript.unsupportedTools ?? 0),
    0,
  );
  if (unsupported)
    warnings.push(
      `${unsupported} tool calls use a format this recorder does not yet interpret. Their individual edits are unavailable; external changes show repository reconciliation, not proven attribution to those calls.`,
    );
  const isRepo = repoRoot(root) !== undefined;
  // Where HEAD stood at the start is asked before knowing there are commits
  // at all, and its answer dropped if there are none.
  const heading = isRepo ? git.head(root) : undefined;
  const starting =
    isRepo && !request.base && main.startedAt
      ? git.headAt(root, main.startedAt)
      : undefined;
  const moves = isRepo ? git.reflog(root) : undefined;
  const current = await heading;
  // A repository with no commits yet still has a working tree to compare.
  const hasCommits = current !== undefined;
  const base = request.base
    ? git.resolve(root, request.base)
    : hasCommits && main.startedAt
      ? await starting
      : undefined;
  const end = request.end ? git.resolve(root, request.end) : undefined;
  if (!isRepo)
    warnings.push(`${root} is not a git repository: no base, no reconciliation.`);
  if (request.base && !base) warnings.push(`Unknown base ${request.base}.`);
  if (request.end && !end) warnings.push(`Unknown end ${request.end}.`);

  request.onProgress?.("Finding saved annotations");
  const saved = findSaved(root, main.sessionId ?? request.session.id);
  const previous = saved ? readReplay(root, saved) : undefined;
  const head = end ?? current;

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
  request.onProgress?.("Identifying repository changes");
  const merging =
    base && head ? git.mergedIn(root, base, head, !end, moves) : new Set<string>();
  // Listed once for both what changed and whether the tree is dirty: each
  // listing walks the whole working tree, which in a checkout full of
  // generated or ignored files takes most of a second.
  const untracked = isRepo && !end ? git.untrackedFiles(root) : undefined;
  const changing = base ? git.changedFiles(root, base, end, untracked) : [];
  // Asked now, read once the paths are known.
  const tree = base ? git.listTree(root, base) : undefined;
  const tracked = isRepo ? git.trackedFiles(root) : undefined;
  const committing = base && head ? git.commitsBetween(root, base, head) : [];
  const dirtying = end ? false : isRepo && git.isDirty(root, untracked);
  const [merged, everyChange] = await Promise.all([merging, changing]);
  const mine = new Set(touched);
  const changed = everyChange.filter((path) => !merged.has(path) || mine.has(path));
  const paths = [...new Set([...touched, ...changed])];
  // One git process for every base file, not two per file: the hook runs
  // this after every turn.
  request.onProgress?.(`Reading ${paths.length} source snapshots`);
  const [bases, secret, dirty, commits] = await Promise.all([
    base ? git.readFilesAt(root, base, paths, tree) : new Map<string, string | null>(),
    isRepo ? git.ignored(root, paths, tracked) : new Set<string>(),
    dirtying,
    committing,
  ]);

  request.onProgress?.("Reconstructing session changes");
  const replay = capture(transcripts, {
    root,
    aliases,
    repo: {
      name: basename(root),
      branch: main.branch ?? git.branch(root),
      base,
      end: head,
      dirty,
      commits,
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
        : (path) => git.readWorking(root, path, 2 * 1024 * 1024)
      : undefined,
    // The working tree's own clock: a change no recorded call explains lands
    // when its file was last written, rather than at the end.
    modifiedAt: isRepo && !end ? (path) => modifiedAt(root, path) : undefined,
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
