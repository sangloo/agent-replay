/**
 * Finding agent sessions on this machine — every supported agent's, in one
 * list.
 *
 *   Claude Code  ~/.claude/projects/<project>/<session>.jsonl
 *                (subagents: <session>/subagents/*.jsonl)
 *   Codex        $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl[.zst]
 *   Gemini CLI   ~/.gemini/tmp/<project>/chats/session-<ts>-<id8>.json[l]
 *                (subagents: chats/<session>/*.jsonl)
 *
 * Listing reads only the head of each log (for the first prompt and the
 * directory) and the file's mtime, so a machine with hundreds of sessions
 * lists instantly. Nothing here writes.
 */

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import * as zlib from "node:zlib";

import { parseTranscript, titleOf, type Transcript } from "@agent-replay/core";

export interface SessionSummary {
  id: string;
  /** Which agent: `claude-code`, `codex`, `gemini-cli`. */
  agent: string;
  file: string;
  /** The directory the session started in. */
  cwd?: string;
  title: string;
  startedAt?: string;
  /** When the log was last written. */
  updatedAt: string;
  bytes: number;
}

/** Where each agent keeps its data. Overridable, for tests and odd setups. */
export interface Homes {
  claude: string;
  codex: string;
  gemini: string;
}

export function defaultHomes(): Homes {
  return {
    claude: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
    codex: process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    gemini: join(homedir(), ".gemini"),
  };
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Every session log each agent keeps, unsorted. */
function logFiles(homes: Homes): string[] {
  const claude = join(homes.claude, "projects");
  const claudeFiles = list(claude).flatMap((project) =>
    list(join(claude, project))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(claude, project, name)),
  );

  const codex = join(homes.codex, "sessions");
  const codexFiles: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const name of list(dir)) {
      const path = join(dir, name);
      if (depth < 3 && isDir(path)) walk(path, depth + 1);
      else if (/^rollout-.*\.jsonl(\.zst)?$/.test(name)) codexFiles.push(path);
    }
  };
  walk(codex, 0);

  const gemini = join(homes.gemini, "tmp");
  const geminiFiles = list(gemini).flatMap((project) =>
    list(join(gemini, project, "chats"))
      .filter((name) => /^session-.*\.jsonl?$/.test(name))
      .map((name) => join(gemini, project, "chats", name)),
  );

  return [...claudeFiles, ...codexFiles, ...geminiFiles];
}

/** A log's bytes, decompressed when Codex has archived it. */
function readBytes(file: string): Buffer {
  const bytes = readFileSync(file);
  if (!file.endsWith(".zst")) return bytes;
  // zstd arrived in Node 22.15; on an older Node an archived Codex log is
  // skipped rather than taking the whole listing down.
  const decompress = (zlib as { zstdDecompressSync?: (data: Buffer) => Buffer })
    .zstdDecompressSync;
  if (!decompress) throw new Error(`Reading ${file} needs Node 22.15 or newer.`);
  return decompress(bytes);
}

/** A line longer than this is worth a look for pasted images to drop. */
const BULKY_LINE = 256 * 1024;
/** And one still longer than this after that is skipped: nothing replays it. */
const MAX_LINE = 64 * 1024 * 1024;

// Screenshots and pasted images travel inside the log as base64 — often most
// of its bytes, and never part of a replay.
const IMAGE_DATA =
  /("type"\s*:\s*"base64"[^{}]*?"data"\s*:\s*")[A-Za-z0-9+/=]{1024,}(")/g;
const IMAGE_DATA_FIRST =
  /("data"\s*:\s*")[A-Za-z0-9+/=]{1024,}("[^{}]*?"type"\s*:\s*"base64")/g;

/**
 * A log's lines, each decoded on its own. A session log can outgrow the
 * longest string a JavaScript engine will make (about 512 MB): read whole,
 * it failed with "Cannot create a string longer than 0x1fffffe8
 * characters". Line by line it never needs a string longer than one entry.
 */
export function readLog(file: string): string[] {
  const bytes = readBytes(file);
  const lines: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = bytes.indexOf(0x0a, start);
    if (end < 0) end = bytes.length;
    const length = end - start;
    if (length > 0 && length <= MAX_LINE) {
      let line = bytes.toString("utf8", start, end);
      if (length > BULKY_LINE) {
        line = line.replace(IMAGE_DATA, "$1$2").replace(IMAGE_DATA_FIRST, "$1$2");
      }
      lines.push(line);
    }
    start = end + 1;
  }
  return lines;
}

/**
 * The start of a log: enough for the first prompt and the directory. Most
 * logs have both in the first few kilobytes; a session that opens with a
 * large snapshot needs more, so a second, longer read covers it.
 */
const HEAD_BYTES = [64 * 1024, 512 * 1024];

function readHead(file: string, bytes: number): string | string[] {
  if (file.endsWith(".zst") || file.endsWith(".json")) return readLog(file);
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const read = readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Gemini keeps the project's path beside its chats, not in them. */
function geminiRoot(file: string): string | undefined {
  const marker = join(dirname(dirname(file)), ".project_root");
  try {
    return readFileSync(marker, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

// Summaries are kept until their log changes, so listing (and searching)
// every session on the machine reads each log once.
const summaries = new Map<string, { stamp: string; summary?: SessionSummary }>();

function summarize(file: string): SessionSummary | undefined {
  let stats;
  try {
    stats = statSync(file);
  } catch {
    return undefined;
  }
  const stamp = `${stats.mtimeMs}:${stats.size}`;
  const cached = summaries.get(file);
  if (cached?.stamp === stamp) return cached.summary;

  let head: Transcript | undefined;
  let prompt;
  for (const bytes of HEAD_BYTES) {
    try {
      head = parseTranscript(readHead(file, bytes));
    } catch {
      head = undefined;
      break;
    }
    prompt = head.events.find(
      (event) => event.type === "prompt" && event.agent === "main",
    );
    if (prompt || stats.size <= bytes) break;
  }
  const summary: SessionSummary | undefined = head && {
    id: head.sessionId ?? basename(file).replace(/\.jsonl?(\.zst)?$/, ""),
    agent: head.source,
    file,
    cwd: head.cwd ?? (head.source === "gemini-cli" ? geminiRoot(file) : undefined),
    title:
      prompt && prompt.type === "prompt" ? titleOf(prompt.text) : "Untitled session",
    startedAt: head.startedAt,
    updatedAt: stats.mtime.toISOString(),
    bytes: stats.size,
  };
  summaries.set(file, { stamp, summary });
  return summary;
}

function byRecency(files: string[]): string[] {
  return files
    .map((file) => {
      try {
        return { file, mtime: statSync(file).mtimeMs };
      } catch {
        return { file, mtime: 0 };
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => file);
}

/** Every agent's sessions on this machine, most recently active first. */
export function listSessions(
  limit = Infinity,
  homes = defaultHomes(),
): SessionSummary[] {
  return byRecency(logFiles(homes))
    .slice(0, limit)
    .map(summarize)
    .filter((session): session is SessionSummary => session !== undefined);
}

/** A session by id (or an unambiguous prefix), or by the path of its log. */
export function findSession(
  idOrFile: string,
  homes = defaultHomes(),
  options: { exact?: boolean } = {},
): SessionSummary | undefined {
  // A log file by path — from the CLI only; the API asks for exact ids.
  if (!options.exact && /\.jsonl?(\.zst)?$/.test(idOrFile) && existsSync(idOrFile)) {
    return summarize(idOrFile);
  }
  const files = byRecency(logFiles(homes));
  // File names carry the id (Gemini: its first eight characters), so most
  // lookups summarize one file rather than all of them.
  const named = files.filter((file) => basename(file).includes(idOrFile.slice(0, 8)));
  for (const file of [...named, ...files]) {
    const session = summarize(file);
    if (!session) continue;
    if (session.id === idOrFile) return session;
    if (!options.exact && idOrFile.length >= 8 && session.id.startsWith(idOrFile))
      return session;
  }
  return undefined;
}

/** The session this process runs inside, when an agent says so. */
export function currentSessionId(): string | undefined {
  return (
    process.env.CLAUDE_CODE_SESSION_ID ??
    process.env.CODEX_SESSION_ID ??
    process.env.CODEX_THREAD_ID ??
    process.env.GEMINI_SESSION_ID
  );
}

/** The main log first, then any subagents' found beside it. */
export function loadTranscripts(session: SessionSummary): Transcript[] {
  const main = parseTranscript(readLog(session.file));
  const dirs =
    session.agent === "gemini-cli"
      ? [join(dirname(session.file), session.id)]
      : [join(session.file.replace(/\.jsonl$/, ""), "subagents")];
  const subagents = dirs.flatMap((dir) =>
    list(dir)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .map((name) =>
        parseTranscript(readLog(join(dir, name)), basename(name, ".jsonl")),
      ),
  );
  if (!main.cwd && session.cwd) main.cwd = session.cwd;
  return [main, ...subagents];
}
