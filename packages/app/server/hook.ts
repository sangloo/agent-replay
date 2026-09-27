/**
 * `replay hook` — what an agent runs at the end of a turn or a session, so a
 * replay is captured without anyone, model or person, remembering to.
 *
 * Every agent hands a hook the same few facts in its own shape:
 *
 *   Claude Code  Stop / SessionEnd  JSON on stdin: session_id, transcript_path, cwd
 *   Gemini CLI   AfterAgent / SessionEnd  JSON on stdin: the same three
 *   Codex        `notify` in config.toml  JSON as the last argument:
 *                "thread-id", cwd (hooks.json Stop: as Claude Code)
 *
 * A hook must never get in the agent's way: whatever happens, it exits 0 and
 * prints nothing to stdout, and a session that changed nothing in the
 * repository leaves nothing behind.
 */

import { readFileSync } from "node:fs";

import { isChange } from "@agent-replay/core";

import { captureSession } from "./capture.ts";
import * as git from "./git.ts";
import { findSession } from "./sessions.ts";
import { saveReplay } from "./store.ts";

export interface HookPayload {
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
}

function field(json: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = json[name];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

/** The payload from an argument (Codex notify) or stdin (everyone else). */
export function readPayload(args: readonly string[]): HookPayload {
  const inline = [...args].reverse().find((arg) => arg.trimStart().startsWith("{"));
  let text = inline;
  if (!text && !process.stdin.isTTY) {
    try {
      text = readFileSync(0, "utf8");
    } catch {
      text = undefined;
    }
  }
  let json: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(text ?? "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) {
      json = value as Record<string, unknown>;
    }
  } catch {
    // Nothing usable; fall back to the environment below.
  }
  return {
    sessionId: field(json, "session_id", "sessionId", "thread-id", "thread_id"),
    transcriptPath: field(json, "transcript_path", "transcriptPath"),
    cwd: field(json, "cwd"),
  };
}

/** Capture and save; returns what happened, for a log line. Never throws. */
export function runHook(payload: HookPayload, fallbackCwd: string): string {
  try {
    const session =
      (payload.transcriptPath && findSession(payload.transcriptPath)) ||
      (payload.sessionId && findSession(payload.sessionId)) ||
      undefined;
    if (!session) return "no session found";
    const root = git.repoRoot(payload.cwd ?? session.cwd ?? fallbackCwd);
    if (!root) return "not in a git repository";
    const { replay } = captureSession({ session, root });
    if (!replay.steps.some(isChange)) return "no changes to replay";
    return `saved ${saveReplay(root, replay)}`;
  } catch (error) {
    return `failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
