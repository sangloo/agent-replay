/**
 * Git history → replay: a repository rebuilt commit by commit, in the same
 * format a session replay uses, so the same player plays it.
 *
 * Each commit is a `commit` step (its message is the narration) followed by
 * one step per file it changed — stored as the smallest unambiguous edit, or
 * whole. When the replay starts from nothing (a root commit, or a snapshot
 * to learn a codebase from), the many files that arrive at once come in
 * reading order rather than alphabetically — see `order.ts`.
 *
 * Pure, like capture: git arrives as data, so this is tested without it.
 */

import { editBetween, unstorable } from "./capture.ts";
import {
  REPLAY_DIR,
  REPLAY_VERSION,
  type Replay,
  type ReplayRepo,
  type Step,
} from "./format.ts";
import { readingOrder } from "./order.ts";

export interface HistoryChange {
  path: string;
  /** Content after the commit; `null` when the commit deleted the file. */
  after: string | null;
}

export interface HistoryCommit {
  sha: string;
  subject: string;
  body?: string;
  author?: string;
  /** ISO-8601. */
  at: string;
  changes: HistoryChange[];
  /**
   * Many files arriving at once — a root commit, or a snapshot — whose
   * steps should follow reading order rather than the path order.
   */
  introduces?: boolean;
}

export interface HistoryOptions {
  repo: ReplayRepo;
  /** Content before the first commit of every file the commits touch. */
  base: Record<string, string | null>;
  title: string;
  /** Override the reading order for introducing commits (a model's, say). */
  order?: (paths: string[], contents: Map<string, string | null>) => string[];
  maxFileBytes?: number;
}

export const GIT_HISTORY = "git";

export function buildHistory(
  commits: readonly HistoryCommit[],
  options: HistoryOptions,
): Replay {
  const maxFileBytes = options.maxFileBytes ?? 512 * 1024;
  const tooBig = (path: string, content: string | null | undefined) =>
    unstorable(path, content, maxFileBytes);

  const files: Record<string, string | null> = { ...options.base };
  const state = new Map<string, string | null>(Object.entries(files));
  // A file too large (or a lockfile) at any point is omitted from the start:
  // omitting it partway would leave its earlier edits applied to nothing.
  const omitted = new Set<string>(
    [
      ...Object.entries(files),
      ...commits.flatMap((commit) =>
        commit.changes.map((c) => [c.path, c.after] as const),
      ),
    ]
      .filter(([path, content]) => tooBig(path, content))
      .map(([path]) => path),
  );
  const steps: Step[] = [];

  commits.forEach((commit, turn) => {
    // Authors belong to the commit step; `agent` is the replay's own voice.
    const meta = (id: string) => ({ id, at: commit.at, agent: "main", turn });
    const step: Step = {
      kind: "commit",
      ...meta(`commit:${commit.sha}`),
      sha: commit.sha,
      subject: commit.subject,
    };
    if (commit.body) step.body = commit.body;
    if (commit.author) step.author = commit.author;
    steps.push(step);

    // Replays committed to the repository are not part of its story.
    const contents = new Map(
      commit.changes
        .filter((change) => !change.path.startsWith(`${REPLAY_DIR}/`))
        .map((change) => [change.path, change.after]),
    );
    const paths = [...contents.keys()];
    const ordered = commit.introduces
      ? (options.order?.(paths, contents) ??
        readingOrder(
          paths.map((path) => ({ path, content: contents.get(path) ?? null })),
        ))
      : [...paths].sort((a, b) => a.localeCompare(b));

    for (const path of ordered) {
      if (!contents.has(path)) continue;
      const after = contents.get(path) ?? null;
      if (!state.has(path)) {
        files[path] = null;
        state.set(path, null);
      }
      const before = state.get(path) ?? null;
      if (before === after) continue;
      const id = `${commit.sha}:${path}`;
      if (tooBig(path, after) || tooBig(path, before) || omitted.has(path)) {
        omitted.add(path);
        steps.push(
          after === null
            ? { kind: "delete", ...meta(id), path }
            : {
                kind: "external",
                ...meta(id),
                path,
                content: "",
                reason: "untracked",
                omitted: true,
              },
        );
      } else if (after === null) {
        steps.push({ kind: "delete", ...meta(id), path });
      } else {
        const edit = before === null ? undefined : editBetween(before, after);
        steps.push(
          edit
            ? { kind: "edit", ...meta(id), path, ...edit, replaceAll: false }
            : { kind: "write", ...meta(id), path, content: after },
        );
      }
      state.set(path, after);
    }
  });

  for (const path of omitted) {
    if (files[path] !== null) files[path] = "";
  }
  return {
    version: REPLAY_VERSION,
    id: `history-${(options.repo.base ?? "root").slice(0, 12)}-${(options.repo.end ?? "head").slice(0, 12)}`,
    title: options.title,
    source: GIT_HISTORY,
    startedAt: commits[0]?.at ?? "",
    endedAt: commits.at(-1)?.at ?? "",
    repo: options.repo,
    files: Object.fromEntries(
      Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
    ),
    omitted: [...omitted].sort(),
    steps,
    notes: {},
  };
}
