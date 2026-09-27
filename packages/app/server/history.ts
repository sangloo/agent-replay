/**
 * A repository's git history → a replay, with git supplying everything.
 *
 * `from` is where the replay starts (default: the root, or the last `limit`
 * commits of a long history). With `learn`, the files that already exist at
 * `from` are introduced first, in reading order, as a snapshot — the way to
 * meet a codebase you did not write before following what changed in it.
 */

import { basename } from "node:path";

import { buildHistory, type HistoryCommit, type Replay } from "@agent-replay/core";

import * as git from "./git.ts";
import { findSaved, readReplay } from "./store.ts";

export interface HistoryRequest {
  root: string;
  from?: string;
  to?: string;
  /** Most commits to include when `from` is not given. */
  limit?: number;
  /** Introduce the files at `from` first, as a snapshot in reading order. */
  learn?: boolean;
  /** Only these paths (directories or files): one package of a monorepo, say. */
  paths?: string[];
  title?: string;
}

export function captureHistory(request: HistoryRequest): {
  replay: Replay;
  warnings: string[];
} {
  const { root } = request;
  const warnings: string[] = [];
  const end = git.resolve(root, request.to ?? "HEAD");
  if (!end) throw new Error(`Unknown revision ${request.to ?? "HEAD"} in ${root}.`);
  const explicitFrom = request.from ? git.resolve(root, request.from) : undefined;
  if (request.from && !explicitFrom)
    throw new Error(`Unknown revision ${request.from}.`);

  const scope = (request.paths ?? [])
    .map((path) => path.replace(/\/+$/, ""))
    .filter(Boolean);
  const inScope = (path: string) =>
    scope.length === 0 ||
    scope.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  const limit = request.limit ?? 300;
  // One more than the limit tells us whether there was more, without
  // reading a long history's whole log.
  let commits = git.commitsIn(
    root,
    explicitFrom ? `${explicitFrom}..${end}` : end,
    scope,
    explicitFrom ? undefined : limit + 1,
  );
  if (!explicitFrom && commits.length > limit) {
    warnings.push(
      `More than ${limit} commits; replaying the last ${limit}. Pass --from or --limit for more.`,
    );
    commits = commits.slice(-limit);
  }
  const from = explicitFrom ?? commits[0]?.parent;

  // Content of every file each commit touched, before and after, in bulk.
  const changes = commits.map((commit) =>
    git.changedIn(root, commit).filter((change) => inScope(change.path)),
  );
  const snapshot = request.learn && from ? git.filesAt(root, from).filter(inScope) : [];
  const specs = [
    ...snapshot.map((path) => `${from}:${path}`),
    ...commits.flatMap((commit, i) =>
      changes[i]!.filter((c) => !c.deleted).map((c) => `${commit.sha}:${c.path}`),
    ),
    // Every file any commit touches starts as it was at `from` — not only
    // the first commit's, or a file first changed later would read as new.
    ...(from && !request.learn ? changes.flat().map((c) => `${from}:${c.path}`) : []),
  ];
  const blobs = git.readBlobs(root, specs);
  const blob = (rev: string, path: string) => blobs.get(`${rev}:${path}`) ?? null;

  // Files the replay touches start as they were at `from` — or not at all,
  // when learning (the snapshot brings them in) or starting at the root.
  const base: Record<string, string | null> = {};
  const history: HistoryCommit[] = [];
  if (request.learn && from && snapshot.length > 0) {
    history.push({
      sha: from,
      subject: `The repository at ${from.slice(0, 7)}`,
      body: "Every file as it stood where this replay starts, in reading order: what it is, how it is put together, where it starts, then down the imports.",
      // The snapshot is the repository at `from`, so it is dated by `from` —
      // which also dates a replay whose range holds no commits at all.
      at: git.commitDate(root, from) ?? commits[0]?.at ?? "",
      introduces: true,
      changes: snapshot.map((path) => ({ path, after: blob(from, path) })),
    });
  } else if (from) {
    for (const change of changes.flat()) {
      if (!(change.path in base)) base[change.path] = blob(from, change.path);
    }
  }
  commits.forEach((commit, i) => {
    history.push({
      sha: commit.sha,
      subject: commit.subject,
      ...(commit.body ? { body: commit.body } : {}),
      author: commit.author,
      at: commit.at,
      introduces: !commit.parent,
      changes: changes[i]!.map((change) => ({
        path: change.path,
        after: change.deleted ? null : blob(commit.sha, change.path),
      })),
    });
  });

  const name = scope.length ? `${basename(root)}/${scope.join(", ")}` : basename(root);
  const replay = buildHistory(history, {
    repo: {
      name,
      branch: git.branch(root),
      base: from,
      end,
      commits: commits.map((commit) => ({ sha: commit.sha, subject: commit.subject })),
    },
    base,
    title:
      request.title ??
      `${name}: ${from ? `${from.slice(0, 7)}..` : "from the first commit to "}${end.slice(0, 7)}`,
  });
  // Replaying the same range again replaces the saved file: keep its notes,
  // and its title unless a new one was given — notes are the part a person
  // (or a model run that cost money) wrote, and nothing else can recreate them.
  const saved = findSaved(root, replay.id);
  const previous = saved ? readReplay(root, saved) : undefined;
  if (previous) {
    const steps = new Set(replay.steps.map((step) => step.id));
    replay.notes = Object.fromEntries(
      Object.entries(previous.notes).filter(([id]) => steps.has(id)),
    );
    if (!request.title) replay.title = previous.title;
  }
  return { replay, warnings };
}
