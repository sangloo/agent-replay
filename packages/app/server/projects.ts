/**
 * Projects: the repositories the player knows about.
 *
 * Three sources, merged: the repositories it was started for (`replay open`
 * in a repo, `REPLAY_REPOS`), every repository an agent session ran in (a
 * session's directory, up to its git root), and folders someone added by
 * hand — remembered in `$XDG_CONFIG_HOME/replay/projects.json` (default
 * `~/.config`). Besides that, the tool writes only `progress.json` there
 * (see progress.ts) outside a repository.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { REPLAY_DIR } from "@agent-replay/core";

import * as git from "./git.ts";

export function configDir(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "replay");
}

function projectsFile(): string {
  return join(configDir(), "projects.json");
}

/** Folders added by hand, in the order they were added. */
export function readAdded(): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(projectsFile(), "utf8"));
    const list =
      parsed && typeof parsed === "object" && "projects" in parsed
        ? (parsed as { projects: unknown }).projects
        : undefined;
    return Array.isArray(list)
      ? list.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeAdded(paths: readonly string[]): void {
  const file = projectsFile();
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ projects: paths }, null, 2)}\n`);
  renameSync(temp, file);
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** `~/x`, relative or absolute, to a real absolute path — or undefined. */
export function realFolder(path: string): string | undefined {
  const expanded = path.startsWith("~")
    ? join(homedir(), path.slice(1))
    : isAbsolute(path)
      ? path
      : resolve(homedir(), path);
  if (!isDir(expanded)) return undefined;
  try {
    return realpathSync(expanded);
  } catch {
    return expanded;
  }
}

// A session's directory to its repository's root, asked of git once.
const roots = new Map<string, string>();

/** The repository a directory is in — or the directory, outside one. */
export function rootOf(dir: string): string {
  let root = roots.get(dir);
  if (root === undefined) {
    root = isDir(dir) ? (git.repoRoot(dir) ?? dir) : dir;
    roots.set(dir, root);
  }
  return root;
}

/** Add a folder (its repository's root, when it is in one). */
export function addProject(path: string): string {
  const folder = realFolder(path);
  if (!folder) throw new Error(`${path} is not a folder on this machine.`);
  const root = rootOf(folder);
  const added = readAdded();
  if (!added.includes(root)) writeAdded([...added, root]);
  return root;
}

/** Forget a folder added by hand. Sessions that ran there still list it. */
export function removeProject(root: string): void {
  const added = readAdded();
  if (added.includes(root)) writeAdded(added.filter((path) => path !== root));
}

export interface FolderListing {
  path: string;
  parent?: string;
  home: string;
  /** The folder is a repository's root. */
  repo: boolean;
  folders: { name: string; path: string; repo: boolean }[];
}

const SKIP = new Set(["node_modules", "Library", "Applications", "System"]);

/** The folders inside `path` (default: home), for choosing one to add. */
export function listFolders(path?: string): FolderListing {
  const home = homedir();
  const folder = path ? realFolder(path) : home;
  if (!folder) throw new Error(`${path} is not a folder on this machine.`);
  let names: string[] = [];
  try {
    names = readdirSync(folder, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && !entry.name.startsWith(".") && !SKIP.has(entry.name),
      )
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .slice(0, 500);
  } catch {
    // Unreadable: listed as empty, and the path still offered.
  }
  const parent = dirname(folder);
  return {
    path: folder,
    ...(parent !== folder ? { parent } : {}),
    home,
    repo: existsSync(join(folder, ".git")),
    folders: names.map((name) => {
      const child = join(folder, name);
      return { name, path: child, repo: existsSync(join(child, ".git")) };
    }),
  };
}

export function projectName(root: string): string {
  return basename(root) || root;
}

/** A folder inside a project, named from the project: `app/tutorials/backend`. */
export function folderName(root: string, folder: string): string {
  return folder === root
    ? projectName(root)
    : `${projectName(root)}/${relative(root, folder).split("\\").join("/")}`;
}

// A walk for saved replays skips dependencies and build output as well:
// none of them holds a course, and some hold a great many folders.
const SCAN_SKIP = new Set([
  ...SKIP,
  "vendor",
  "dist",
  "build",
  "target",
  "coverage",
  "__pycache__",
]);
/** How many levels below a project a walk looks, and how many folders it reads. */
export const SCAN_DEPTH = 4;
const SCAN_FOLDERS = 2000;
// Every listing asks, so a project's answer is kept a little while — long
// enough to serve a page's few requests, short enough that a course written
// into a new folder shows up on the next visit.
const SCAN_TTL = 15_000;
const scans = new Map<string, { at: number; folders: string[] }>();

/**
 * The folders in a project that keep replays: the project itself, then any
 * folder up to a few levels down with a `.replays/` of its own — a course
 * written into `tutorials/backend/.replays/` belongs to the repository around
 * it. The walk is breadth-first and bounded by depth and by folders read; it
 * never follows a link, and skips hidden folders and dependencies.
 */
export function replayFolders(root: string): string[] {
  const now = Date.now();
  const cached = scans.get(root);
  if (cached && now - cached.at < SCAN_TTL) return cached.folders;
  const nested: string[] = [];
  let level = [root];
  let budget = SCAN_FOLDERS;
  for (let depth = 0; depth <= SCAN_DEPTH && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      if (budget-- <= 0) break;
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        // A link reports itself as one, not as a folder: no cycles.
        if (!entry.isDirectory()) continue;
        if (entry.name === REPLAY_DIR) {
          if (depth > 0) nested.push(dir);
        } else if (
          depth < SCAN_DEPTH &&
          !entry.name.startsWith(".") &&
          !SCAN_SKIP.has(entry.name)
        ) {
          next.push(join(dir, entry.name));
        }
      }
    }
    level = next;
  }
  const folders = [root, ...nested.sort()];
  scans.delete(root);
  scans.set(root, { at: now, folders });
  for (const key of scans.keys()) {
    if (scans.size <= 64) break;
    scans.delete(key);
  }
  return folders;
}
