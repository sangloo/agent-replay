/**
 * The few git questions a capture asks, answered by the `git` binary.
 *
 * Every function returns `undefined` rather than throwing when git cannot
 * answer — a directory that is not a repository, a commit that is gone, a
 * reflog that was expired. A capture without git still works; it just
 * cannot reconcile, and says so.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { join } from "node:path";

import { REPLAY_DIR, type Commit } from "@agent-replay/core";

function git(root: string, args: string[]): Buffer | undefined {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function text(root: string, args: string[]): string | undefined {
  return git(root, args)?.toString("utf8").trim();
}

/** Binary content is kept as a NUL marker so a capture leaves it out. */
function decode(buffer: Buffer): string {
  return buffer.includes(0) ? "\u0000binary" : buffer.toString("utf8");
}

export function repoRoot(dir: string): string | undefined {
  return text(dir, ["rev-parse", "--show-toplevel"]) || undefined;
}

export function head(root: string): string | undefined {
  return text(root, ["rev-parse", "HEAD"]) || undefined;
}

export function branch(root: string): string | undefined {
  const name = text(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return name && name !== "HEAD" ? name : undefined;
}

export function resolve(root: string, rev: string): string | undefined {
  return text(root, ["rev-parse", "--verify", `${rev}^{commit}`]) || undefined;
}

/**
 * Where HEAD pointed at `time` — the session's base commit.
 *
 * The reflog answers it exactly, checkouts and resets included. When the
 * reflog does not reach back that far, the parent of the first commit made
 * since is the next best answer, and HEAD itself when nothing was committed.
 */
export function headAt(root: string, time: string): string | undefined {
  const at = Date.parse(time);
  if (Number.isNaN(at)) return head(root);
  const reflog = text(root, [
    "reflog",
    "show",
    "--date=iso-strict",
    "--format=%H%x09%gd",
    "HEAD",
  ]);
  for (const line of reflog?.split("\n") ?? []) {
    const [sha, selector] = line.split("\t");
    const when = /\{(.+)\}$/.exec(selector ?? "")?.[1];
    if (sha && when && Date.parse(when) <= at) return sha;
  }
  const since = text(root, [
    "rev-list",
    "--reverse",
    `--since=${new Date(at).toISOString()}`,
    "HEAD",
  ])?.split("\n")[0];
  if (since) return resolve(root, `${since}^`) ?? since;
  return head(root);
}

/** When a commit was authored, ISO 8601. */
export function commitDate(root: string, rev: string): string | undefined {
  return text(root, ["log", "-1", "--format=%aI", rev]) || undefined;
}

/** A file at a commit; `null` when it does not exist there. */
export function showFile(root: string, rev: string, path: string): string | null {
  const buffer = git(root, ["show", `${rev}:${path}`]);
  return buffer === undefined ? null : decode(buffer);
}

/** A file in the working tree; `null` when it does not exist. */
export function readWorking(
  root: string,
  path: string,
  maxBytes?: number,
): string | null {
  let fd: number | undefined;
  try {
    if (maxBytes === undefined) return decode(readFileSync(join(root, path)));
    fd = openSync(join(root, path), "r");
    const size = fstatSync(fd).size;
    if (size > maxBytes) return "\0binary"; // capture's existing omitted-body marker
    const buffer = Buffer.allocUnsafe(size + 1);
    let used = 0;
    while (used < buffer.length) {
      const read = readSync(fd, buffer, used, buffer.length - used, null);
      if (!read) break;
      used += read;
    }
    // A concurrently growing file is omitted rather than returned truncated.
    if (used > size) return "\0binary";
    return decode(buffer.subarray(0, used));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Paths that differ between `base` and `end` — or the working tree, untracked
 * files included, when there is no `end`.
 */
export function changedFiles(root: string, base: string, end?: string): string[] {
  const split = (out: string | undefined) =>
    (out ?? "").split("\u0000").filter(Boolean);
  if (end) {
    return split(text(root, ["diff", "--name-only", "-z", base, end]));
  }
  return [
    ...split(text(root, ["diff", "--name-only", "-z", base])),
    ...split(text(root, ["ls-files", "--others", "--exclude-standard", "-z"])),
  ];
}

export function commitsBetween(root: string, base: string, end: string): Commit[] {
  const out = text(root, ["log", "--reverse", "--format=%H%x09%s", `${base}..${end}`]);
  return (out ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha = "", ...subject] = line.split("\t");
      return { sha, subject: subject.join("\t") };
    });
}

/** Uncommitted changes — not counting replays, which are written after the work. */
export function isDirty(root: string): boolean {
  return Boolean(
    text(root, ["status", "--porcelain", "--", ".", `:(exclude)${REPLAY_DIR}`]),
  );
}

/**
 * Many files at many commits in one `git cat-file --batch` process — a first
 * commit of a thousand files would otherwise be a thousand spawns. Keys are
 * `rev:path`; a missing object is `null`.
 */
export function readBlobs(
  root: string,
  specs: readonly string[],
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (specs.length === 0) return out;
  const unique = [...new Set(specs)];
  let buffer: Buffer;
  try {
    buffer = execFileSync("git", ["-C", root, "cat-file", "--batch"], {
      input: `${unique.join("\n")}\n`,
      maxBuffer: 2 * 1024 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return out;
  }
  let at = 0;
  for (const spec of unique) {
    const eol = buffer.indexOf(10, at);
    if (eol < 0) break;
    const header = buffer.subarray(at, eol).toString("utf8");
    at = eol + 1;
    const match = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
    if (!match) {
      out.set(spec, null);
      continue;
    }
    const size = Number(match[2]);
    out.set(spec, match[1] === "blob" ? decode(buffer.subarray(at, at + size)) : null);
    at += size + 1;
  }
  return out;
}

export interface CommitInfo {
  sha: string;
  parent?: string;
  author: string;
  at: string;
  subject: string;
  body: string;
}

/** Commits in `range`, oldest first, along the first-parent line. */
export function commitsIn(
  root: string,
  range: string,
  paths: readonly string[] = [],
  /** Only the newest this many — without reading the whole log. */
  newest?: number,
): CommitInfo[] {
  const out = text(root, [
    "log",
    "--first-parent",
    ...(newest ? [`--max-count=${newest}`] : []),
    "--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%b%x1e",
    range,
    ...(paths.length ? ["--", ...paths] : []),
  ]);
  return (out ?? "")
    .split("\u001e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = "", parents = "", author = "", at = "", subject = "", body = ""] =
        record.split("\u001f");
      return {
        sha,
        parent: parents.split(" ")[0] || undefined,
        author,
        at,
        subject,
        body: body.trim(),
      };
    })
    .reverse();
}

/** Paths a commit changed against its first parent (or all, for a root). */
export function changedIn(
  root: string,
  commit: CommitInfo,
): { path: string; deleted: boolean }[] {
  const args = commit.parent
    ? [
        "diff-tree",
        "-r",
        "--no-commit-id",
        "--no-renames",
        "--name-status",
        "-z",
        commit.parent,
        commit.sha,
      ]
    : [
        "diff-tree",
        "-r",
        "--no-commit-id",
        "--root",
        "--no-renames",
        "--name-status",
        "-z",
        commit.sha,
      ];
  const parts = (git(root, args)?.toString("utf8") ?? "")
    .split("\u0000")
    .filter(Boolean);
  const out: { path: string; deleted: boolean }[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    out.push({ path: parts[i + 1]!, deleted: parts[i]!.startsWith("D") });
  }
  return out;
}

/** Every file at a commit. */
export function filesAt(root: string, rev: string): string[] {
  return (text(root, ["ls-tree", "-r", "--name-only", "-z", rev]) ?? "")
    .split("\u0000")
    .filter(Boolean);
}

/** Which of `paths` git ignores — secrets like `.env.local` live there. */
export function ignored(root: string, paths: readonly string[]): Set<string> {
  if (paths.length === 0) return new Set();
  // check-ignore excludes tracked files by definition. Remove them in bulk
  // rather than making it consult the index independently for thousands of paths.
  const indexed = git(root, ["ls-files", "--cached", "-z"]);
  const tracked = new Set(indexed?.toString("utf8").split("\u0000") ?? []);
  const candidates = paths.filter((path) => !tracked.has(path));
  if (!candidates.length) return new Set();
  try {
    const out = execFileSync("git", ["-C", root, "check-ignore", "--stdin", "-z"], {
      input: candidates.join("\u0000"),
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    });
    return new Set(out.toString("utf8").split("\u0000").filter(Boolean));
  } catch {
    // Exit 1 means "none of them"; anything else means we cannot tell.
    return new Set();
  }
}

/**
 * Files that arrived in `base..end` rather than being made there: what a
 * merge or a fast-forwarding pull brought in, and the session did not also
 * change itself.
 *
 * The reflog says it exactly — every move of HEAD, and whether it was the
 * session's commit, a merge or a fast-forward — so where it covers `end` (a
 * capture in the clone the session ran in), it alone is read: a file is left
 * out when something arrived with it and none of the session's own commits
 * (nor, with `working`, its uncommitted work) changed it. A lockfile both
 * sides changed stays, so the session's part of it is not lost. Merge commits
 * alone cannot say this: a branch that merged main (with this session's work
 * already on it) and then arrived by fast-forward carries a merge whose
 * "brought in" side is the session's own files. Without a reflog,
 * first-parent merge commits are the best evidence there is.
 */
export function mergedIn(
  root: string,
  base: string,
  end: string,
  working = false,
): Set<string> {
  const isAncestor = (a: string, b: string) =>
    git(root, ["merge-base", "--is-ancestor", a, b]) !== undefined;
  const within = ([from, to]: [string, string]) =>
    isAncestor(base, from) && isAncestor(to, end);
  const names = (...args: string[]) =>
    (text(root, ["diff", "--name-only", "-z", ...args]) ?? "")
      .split("\u0000")
      .filter(Boolean);
  const log = reflog(root);

  if (!log.some((entry) => entry.sha === end)) {
    const paths = new Set<string>();
    for (const merge of (
      text(root, ["rev-list", "--merges", "--first-parent", `${base}..${end}`]) ?? ""
    )
      .split("\n")
      .filter(Boolean)) {
      for (const path of names(`${merge}^1`, merge)) paths.add(path);
    }
    return paths;
  }

  const arrived = new Set<string>();
  for (const range of arrivals(log).filter(within)) {
    for (const path of names(...range)) arrived.add(path);
  }
  if (arrived.size === 0) return arrived;
  const own = new Set<string>();
  const inspected = new Set<string>();
  for (const { sha, subject } of log) {
    if (!/^commit( \(amend\))?:/.test(subject) || inspected.has(sha)) continue;
    inspected.add(sha);
    const range: [string, string] = [`${sha}^1`, sha];
    if (!within(range)) continue;
    for (const path of names(...range)) own.add(path);
  }
  if (working) for (const path of names("HEAD")) own.add(path);
  return new Set([...arrived].filter((path) => !own.has(path)));
}

interface ReflogEntry {
  sha: string;
  subject: string;
}

/**
 * The session's branch's recent moves, newest first — the branch's own
 * reflog, which holds only what happened to it; HEAD's also holds commits
 * made on other branches in the same clone. HEAD's when it is detached.
 */
function reflog(root: string): ReflogEntry[] {
  const branch = text(root, ["symbolic-ref", "-q", "HEAD"]);
  return (
    text(root, [
      "reflog",
      "show",
      "-n",
      "1000",
      "--format=%H%x09%gs",
      branch || "HEAD",
    ]) ?? ""
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha = "", subject = ""] = line.split("\t");
      return { sha, subject };
    });
}

/**
 * The moves that brought commits in, as [from, to]: a merge from its first
 * parent (HEAD before it), a fast-forward from where HEAD was.
 */
function arrivals(log: readonly ReflogEntry[]): [string, string][] {
  const ranges: [string, string][] = [];
  log.forEach(({ sha, subject }, i) => {
    if (!/^(merge|pull)\b/.test(subject)) return;
    if (/: Fast-forward$/.test(subject)) {
      const from = log[i + 1]?.sha;
      if (from) ranges.push([from, sha]);
    } else if (/: Merge made by/.test(subject)) {
      ranges.push([`${sha}^1`, sha]);
    }
  });
  return ranges;
}

/** Resolve a revision's tree once instead of traversing it once per missing path. */
export function readFilesAt(
  root: string,
  rev: string,
  paths: readonly string[],
): Map<string, string | null> {
  const listing = git(root, ["ls-tree", "-r", "-z", rev]);
  if (!listing)
    return readBlobs(
      root,
      paths.map((path) => `${rev}:${path}`),
    );
  const wanted = new Set(paths),
    objects = new Map<string, string>();
  for (const entry of listing.toString("utf8").split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const path = entry.slice(tab + 1);
    if (!wanted.has(path)) continue;
    const [, type, sha] = entry.slice(0, tab).split(" ");
    if (type === "blob" && sha) objects.set(path, sha);
  }
  const blobs = readBlobs(root, [...objects.values()]);
  return new Map(
    paths.map((path) => [
      `${rev}:${path}`,
      objects.has(path) ? (blobs.get(objects.get(path)!) ?? null) : null,
    ]),
  );
}
