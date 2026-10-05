/**
 * Gemini CLI: `~/.gemini/tmp/<project>/chats/session-<ts>-<id8>.jsonl` — or,
 * on older installs, one `.json` object `{ sessionId, …, messages: [...] }`.
 *
 * The JSONL form is a log of records, not a list of messages:
 *
 * - the first record is metadata (`sessionId`, `startTime`, …) and
 *   `{ "$set": {…} }` patches it;
 * - a message record (`id`, `timestamp`, `type`: user | gemini | info | …)
 *   is re-appended as the message grows, so the LAST copy of an id wins;
 * - `{ "$rewindTo": id }` deletes that message and everything after it.
 *
 * A `gemini` message's `toolCalls` carry arguments, result and status, and
 * an edit's `resultDisplay` carries `originalContent` — the file as the tool
 * found it — which gives capture the same drift detection as Claude Code.
 */

import {
  absolute,
  cleanPrompt,
  isObject,
  jsonLines,
  logText,
  type Log,
  str,
  textOf,
  type Action,
  type Json,
  type Transcript,
  type TranscriptEvent,
} from "../transcript.ts";

export const GEMINI_CLI = "gemini-cli";

export function isGeminiCli(firstLines: readonly Json[]): boolean {
  return firstLines.some(
    (line) =>
      (typeof line.sessionId === "string" && typeof line.projectHash === "string") ||
      (Array.isArray(line.messages) && typeof line.sessionId === "string"),
  );
}

function outputOf(call: Json): string {
  if (!Array.isArray(call.result)) return "";
  return call.result
    .map((part) => {
      const response =
        isObject(part) && isObject(part.functionResponse)
          ? part.functionResponse.response
          : undefined;
      return isObject(response)
        ? (str(response.output) ?? str(response.error) ?? "")
        : "";
    })
    .join("\n");
}

function toActions(call: Json): Action[] {
  const args = isObject(call.args) ? call.args : {};
  const display = isObject(call.resultDisplay) ? call.resultDisplay : {};
  const original = str(display.originalContent);
  switch (call.name) {
    case "replace": {
      const path = str(args.file_path);
      if (!path) return [];
      const action: Action = {
        kind: "edit",
        path,
        oldString: str(args.old_string) ?? "",
        newString: str(args.new_string) ?? "",
        replaceAll:
          args.allow_multiple === true ||
          typeof args.expected_replacements === "number",
      };
      if (original !== undefined) action.seen = original;
      return [action];
    }
    case "write_file": {
      const path = str(args.file_path);
      const content = str(args.content);
      if (!path || content === undefined) return [];
      const action: Action = { kind: "write", path, content };
      if (original !== undefined) action.seen = original;
      else if (display.isNewFile === true) action.seen = null;
      return [action];
    }
    case "run_shell_command": {
      const command = str(args.command);
      if (!command) return [];
      const action: Action = { kind: "command", command, output: outputOf(call) };
      const description = str(args.description);
      if (description) action.description = description;
      return [action];
    }
    default:
      return [];
  }
}

/** The records of either format, in order. */
function records(log: Log): Json[] {
  let text = typeof log === "string" ? log : "";
  if (typeof log !== "string") {
    for (const line of log) {
      text = line;
      break;
    }
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") && !trimmed.slice(0, 4096).includes("\n{")) {
    try {
      const whole: unknown = JSON.parse(logText(log));
      if (isObject(whole) && Array.isArray(whole.messages)) {
        const { messages, ...meta } = whole;
        return [meta, ...messages.filter(isObject)];
      }
    } catch {
      // Not one object after all: read it as lines.
    }
  }
  return [...jsonLines(log)];
}

export function parseGeminiCli(text: Log, agent = "main"): Transcript {
  const transcript: Transcript = { source: GEMINI_CLI, events: [] };
  const messages: Json[] = [];
  const index = new Map<string, number>();

  for (const record of records(text)) {
    if (typeof record.$rewindTo === "string") {
      const at = index.get(record.$rewindTo);
      if (at !== undefined) {
        for (const gone of messages.splice(at)) index.delete(str(gone.id) ?? "");
      }
      continue;
    }
    const meta = isObject(record.$set)
      ? record.$set
      : record.type === undefined
        ? record
        : undefined;
    if (meta) {
      transcript.sessionId ??= str(meta.sessionId);
      transcript.startedAt ??= str(meta.startTime);
      if (str(meta.lastUpdated)) transcript.endedAt = str(meta.lastUpdated);
      if (Array.isArray(meta.directories)) transcript.cwd ??= str(meta.directories[0]);
      continue;
    }
    const id = str(record.id);
    if (id && index.has(id)) messages[index.get(id)!] = record;
    else {
      if (id) index.set(id, messages.length);
      messages.push(record);
    }
  }

  for (const message of messages) {
    const at = str(message.timestamp) ?? "";
    if (at) {
      transcript.startedAt ??= at;
      if (!transcript.endedAt || at > transcript.endedAt) transcript.endedAt = at;
    }
    if (message.type === "user") {
      const text = cleanPrompt(textOf(message.content));
      if (text)
        transcript.events.push({
          type: "prompt",
          at,
          agent,
          uuid: str(message.id),
          text,
        });
      continue;
    }
    if (message.type !== "gemini") continue;
    if (Array.isArray(message.thoughts)) {
      const thought = message.thoughts
        .filter(isObject)
        .map((t) => [str(t.subject), str(t.description)].filter(Boolean).join(": "))
        .join("\n");
      if (thought.trim())
        transcript.events.push({ type: "thinking", at, agent, text: thought });
    }
    const said = textOf(message.content);
    if (said.trim())
      transcript.events.push({
        type: "text",
        at,
        agent,
        uuid: str(message.id),
        text: said,
      });
    for (const call of Array.isArray(message.toolCalls)
      ? message.toolCalls.filter(isObject)
      : []) {
      const id = str(call.id);
      if (!id || call.status === "cancelled") continue;
      const actions = toActions(call);
      if (actions.length === 0) continue;
      const output = actions[0]?.kind === "command" ? (actions[0].output ?? "") : "";
      const exit = /Exit Code: (-?\d+)/.exec(output)?.[1];
      const event: TranscriptEvent = {
        type: "action",
        at: str(call.timestamp) ?? at,
        agent,
        id,
        actions,
        failed: call.status !== "success" || (exit !== undefined && exit !== "0"),
      };
      const dir = isObject(call.args) ? str(call.args.dir_path) : undefined;
      // Relative to the project, as the shell tool resolves it.
      if (dir) event.cwd = absolute(dir, transcript.cwd);
      else if (transcript.cwd) event.cwd = transcript.cwd;
      transcript.events.push(event);
    }
  }
  return transcript;
}
