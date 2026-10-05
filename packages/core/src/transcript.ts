/**
 * An agent session, reduced to what a replay needs — in no particular
 * agent's vocabulary.
 *
 * Every agent logs its sessions differently: Claude Code's Edit carries the
 * two strings and the file it found, Codex's apply_patch carries context
 * lines and nothing else, one agent's shell tool takes a string and another's
 * an argv. Each has an adapter in `agents/` that turns its log into these
 * events, and everything downstream — capture, play, the player — only ever
 * sees actions: edit, write, delete, patch, command.
 *
 * Adapters are tolerant by design: no agent's log format is a public
 * contract, entries are added between versions, and a log read while its
 * session is still running can end in half a line. Anything unrecognised is
 * skipped, never fatal.
 */

import type { FilePatch } from "./patch.ts";
import { resolvePath } from "./paths.ts";

/** Something a tool call did. Paths are absolute. */
export type Action =
  | {
      kind: "edit";
      path: string;
      oldString: string;
      newString: string;
      replaceAll: boolean;
      /** The file as the tool found it, when the agent records it. */
      seen?: string;
    }
  | { kind: "write"; path: string; content: string; seen?: string | null }
  | { kind: "delete"; path: string }
  | { kind: "patch"; files: FilePatch[] }
  | { kind: "command"; command: string; description?: string; output?: string };

export type TranscriptEvent =
  | { type: "prompt"; at: string; agent: string; uuid?: string; text: string }
  | { type: "text"; at: string; agent: string; uuid?: string; text: string }
  | { type: "thinking"; at: string; agent: string; text: string }
  | {
      /** One tool call and what it did — several actions for a multi-edit. */
      type: "action";
      at: string;
      agent: string;
      id: string;
      actions: Action[];
      /** The call failed: an edit did not happen; a command still ran. */
      failed: boolean;
      /** Where the call ran, absolute. */
      cwd?: string;
    };

export interface Transcript {
  /** Which agent wrote it: `claude-code`, `codex`, … */
  source: string;
  sessionId?: string;
  cwd?: string;
  branch?: string;
  startedAt?: string;
  endedAt?: string;
  events: TranscriptEvent[];
  /** Tool calls the adapter could not interpret; never claim these were replayed. */
  unsupportedTools?: number;
}

/**
 * Context a harness injects into the person's turn — reminders, command
 * echoes, hook output, environment blocks. It is not what the person said,
 * and it can be large.
 */
const INJECTED =
  /<(system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|environment_context|user_instructions|user_action|task-notification)>[\s\S]*?<\/\1>/g;

export function cleanPrompt(text: string): string {
  return text.replace(INJECTED, "").trim();
}

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * A session log: its text, or its lines. Lines are what a reader hands in
 * for a log too large to hold as one string — past about 512 MB, a
 * JavaScript engine refuses to make the string at all.
 */
export type Log = string | Iterable<string>;

export function logLines(log: Log): Iterable<string> {
  return typeof log === "string" ? log.split("\n") : log;
}

/** The log as one string — only for formats that are one JSON document. */
export function logText(log: Log): string {
  return typeof log === "string" ? log : Array.from(log).join("\n");
}

/** Each non-empty line of a JSONL log that parses as an object. */
export function* jsonLines(log: Log): Generator<Json> {
  for (const line of logLines(log)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isObject(value)) yield value;
    } catch {
      // A half-written last line, or not JSON at all.
    }
  }
}

/** Join `path` onto `cwd` the POSIX way, unless it is already absolute. */
export function absolute(path: string, cwd: string | undefined): string {
  const unix = path.replaceAll("\\", "/");
  if (unix.startsWith("/") || /^[A-Za-z]:\//.test(unix) || !cwd) return unix;
  return resolvePath(cwd.replaceAll("\\", "/"), unix);
}

/** The text of a message's content: a string, or the parts that carry text. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isObject(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}
