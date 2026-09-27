/**
 * OpenAI Codex CLI: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`
 * (`.jsonl.zst` once a week old — decompressing is the reader's job).
 *
 * Every line is `{ timestamp, type, payload }`. What matters:
 *
 * - `session_meta` — the session id, cwd and git state;
 * - `turn_context` — the cwd for the turn that follows (it can change);
 * - `event_msg` `user_message` — what the person typed. `response_item`
 *   messages with role `user` also carry injected context (AGENTS.md, the
 *   environment block), so they are only a fallback;
 * - `response_item` `message` (assistant prose), `reasoning`, and the tool
 *   calls: `function_call` (`exec_command` now, `shell` / `shell_command`
 *   before) and `custom_tool_call` `apply_patch`, each answered by a
 *   `*_output` with the same `call_id`;
 * - `event_msg` `patch_apply_end` — whether a patch applied.
 *
 * A patch carries no copy of the file it changed, so a Codex replay relies
 * on capture applying patches to the state it tracks, and on end-state
 * reconciliation for anything that did not apply as recorded.
 */

import { extractPatch, parsePatch } from "../patch.ts";
import {
  absolute,
  cleanPrompt,
  isObject,
  jsonLines,
  type Log,
  str,
  textOf,
  type Action,
  type Json,
  type Transcript,
  type TranscriptEvent,
} from "../transcript.ts";

export const CODEX = "codex";

export function isCodex(firstLines: readonly Json[]): boolean {
  return firstLines.some(
    (line) =>
      typeof line.type === "string" &&
      isObject(line.payload) &&
      (line.type === "session_meta" ||
        line.type === "response_item" ||
        line.type === "turn_context"),
  );
}

function parseJson(text: string | undefined): Json {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : {};
  } catch {
    return {};
  }
}

/** A shell tool's output, in either era's shape, as text and success. */
function readOutput(raw: unknown): { text: string; failed: boolean } {
  const output =
    typeof raw === "string" ? raw : isObject(raw) ? JSON.stringify(raw) : "";
  // Older: a JSON string `{ output, metadata: { exit_code } }`.
  const json = parseJson(output.trimStart().startsWith("{") ? output : undefined);
  if (typeof json.output === "string") {
    const code = isObject(json.metadata) ? json.metadata.exit_code : undefined;
    return { text: json.output, failed: typeof code === "number" && code !== 0 };
  }
  // Current: "…\nProcess exited with code N\n…\nOutput:\n<text>".
  const code = /Process exited with code (-?\d+)/.exec(output)?.[1];
  const body = output.includes("\nOutput:\n")
    ? output.slice(output.indexOf("\nOutput:\n") + "\nOutput:\n".length)
    : output;
  return { text: body, failed: code !== undefined && code !== "0" };
}

/** `["bash", "-lc", "script"]` → `script`; anything else joined. */
function commandText(command: unknown): string | undefined {
  if (typeof command === "string") return command;
  if (!Array.isArray(command)) return undefined;
  const argv = command.filter((part): part is string => typeof part === "string");
  const shell = argv[0]?.replace(/^.*\//, "");
  if (
    argv.length === 3 &&
    (shell === "bash" || shell === "sh" || shell === "zsh") &&
    argv[1]?.startsWith("-")
  ) {
    return argv[2];
  }
  return argv.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

interface Call {
  at: string;
  id: string;
  cwd?: string;
  /** Builds the actions once the output is known. */
  make: (output: unknown) => { actions: Action[]; failed: boolean };
}

/** A patch as an action, its paths resolved against the call's directory. */
function patchAction(patch: string, cwd: string | undefined): Action[] {
  const files = parsePatch(patch).map((file) => ({
    ...file,
    path: absolute(file.path, cwd),
    ...(file.op === "update" && file.moveTo
      ? { moveTo: absolute(file.moveTo, cwd) }
      : {}),
  }));
  return files.length ? [{ kind: "patch", files }] : [];
}

export function parseCodex(jsonl: Log, agent = "main"): Transcript {
  const transcript: Transcript = { source: CODEX, events: [] };
  const slots: (TranscriptEvent | Call)[] = [];
  const outputs = new Map<string, unknown>();
  const patched = new Map<string, boolean>();
  const typed: TranscriptEvent[] = [];
  const injected: TranscriptEvent[] = [];
  let cwd: string | undefined;

  for (const line of jsonLines(jsonl)) {
    const at = str(line.timestamp) ?? "";
    if (at) {
      transcript.startedAt ??= at;
      transcript.endedAt = at;
    }
    const payload = isObject(line.payload) ? line.payload : {};

    if (line.type === "session_meta") {
      transcript.sessionId ??= str(payload.id) ?? str(payload.session_id);
      cwd = str(payload.cwd) ?? cwd;
      transcript.cwd ??= cwd;
      if (isObject(payload.git)) transcript.branch ??= str(payload.git.branch);
      continue;
    }
    if (line.type === "turn_context") {
      cwd = str(payload.cwd) ?? cwd;
      continue;
    }
    if (line.type === "event_msg") {
      if (payload.type === "user_message") {
        const text = cleanPrompt(str(payload.message) ?? "");
        if (text) {
          const prompt: TranscriptEvent = { type: "prompt", at, agent, text };
          typed.push(prompt);
          slots.push(prompt);
        }
      } else if (
        payload.type === "patch_apply_end" &&
        typeof payload.call_id === "string"
      ) {
        patched.set(payload.call_id, payload.success !== false);
      }
      continue;
    }
    if (line.type !== "response_item") continue;

    switch (payload.type) {
      case "message": {
        const text = textOf(payload.content);
        if (!text.trim()) break;
        if (payload.role === "assistant") {
          slots.push({ type: "text", at, agent, text });
        } else if (payload.role === "user") {
          const prompt = cleanPrompt(text);
          if (prompt) {
            const event: TranscriptEvent = { type: "prompt", at, agent, text: prompt };
            injected.push(event);
            slots.push(event);
          }
        }
        break;
      }
      case "reasoning": {
        const summary = Array.isArray(payload.summary) ? textOf(payload.summary) : "";
        if (summary.trim()) slots.push({ type: "thinking", at, agent, text: summary });
        break;
      }
      case "function_call": {
        const id = str(payload.call_id);
        const name = str(payload.name);
        if (!id || !name) break;
        const args = parseJson(str(payload.arguments));
        const dir = str(args.workdir) ? absolute(str(args.workdir)!, cwd) : cwd;
        const command =
          name === "exec_command" ? str(args.cmd) : commandText(args.command);
        if (!command) break;
        const argv = Array.isArray(args.command) ? args.command : [];
        const patch =
          argv[0] === "apply_patch" || argv[0] === "applypatch"
            ? str(argv[1])
            : command.includes("*** Begin Patch")
              ? extractPatch(command)
              : undefined;
        slots.push({
          at,
          id,
          cwd: dir,
          make: (output) => {
            const { text, failed } = readOutput(output);
            if (patch) return { actions: patchAction(patch, dir), failed };
            return { actions: [{ kind: "command", command, output: text }], failed };
          },
        });
        break;
      }
      case "local_shell_call": {
        const id = str(payload.call_id) ?? str(payload.id);
        const action = isObject(payload.action) ? payload.action : {};
        const command = commandText(action.command);
        if (!id || !command) break;
        const dir = str(action.working_directory) ?? cwd;
        slots.push({
          at,
          id,
          cwd: dir,
          make: (output) => {
            const { text, failed } = readOutput(output);
            return { actions: [{ kind: "command", command, output: text }], failed };
          },
        });
        break;
      }
      case "custom_tool_call": {
        const id = str(payload.call_id);
        const input = str(payload.input);
        if (!id || !input || !/apply_?patch/.test(str(payload.name) ?? "")) break;
        const dir = cwd;
        slots.push({
          at,
          id,
          cwd: dir,
          make: (output) => {
            const text = typeof output === "string" ? output : "";
            const failed =
              patched.get(id) === false ||
              (!patched.has(id) &&
                /^(error|failed|apply_patch verification failed)/i.test(text.trim()));
            return { actions: patchAction(input, dir), failed };
          },
        });
        break;
      }
      case "function_call_output":
      case "custom_tool_call_output":
      case "local_shell_call_output": {
        const id = str(payload.call_id);
        if (id) outputs.set(id, payload.output);
        break;
      }
    }
  }

  // Typed prompts are the person's words; role-user messages are only used
  // when a log has none (older rollouts), because they include injections.
  const drop = new Set<TranscriptEvent>(typed.length ? injected : []);
  for (const slot of slots) {
    if ("type" in slot) {
      if (!drop.has(slot)) transcript.events.push(slot);
      continue;
    }
    if (!outputs.has(slot.id) && !patched.has(slot.id)) continue;
    const { actions, failed } = slot.make(outputs.get(slot.id));
    if (actions.length === 0) continue;
    const event: TranscriptEvent = {
      type: "action",
      at: slot.at,
      agent,
      id: slot.id,
      actions,
      failed,
    };
    if (slot.cwd) event.cwd = slot.cwd;
    transcript.events.push(event);
  }
  return transcript;
}
