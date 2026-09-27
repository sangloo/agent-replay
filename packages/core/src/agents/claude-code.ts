/**
 * Claude Code: `~/.claude/projects/<project>/<session>.jsonl`.
 *
 * One entry per line. The ones that matter are the person's prompts, the
 * assistant's prose and tool calls, and the tool results, whose
 * `toolUseResult` carries the file as the tool found it (`originalFile`) —
 * which is what lets capture notice anything that changed a file between two
 * calls.
 */

import {
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

export const CLAUDE_CODE = "claude-code";

/** Does this look like a Claude Code transcript? */
export function isClaudeCode(firstLines: readonly Json[]): boolean {
  return firstLines.some(
    (entry) =>
      typeof entry.sessionId === "string" &&
      (entry.type === "user" ||
        entry.type === "assistant" ||
        entry.type === "summary" ||
        entry.type === "queue-operation" ||
        entry.type === "attachment"),
  );
}

interface Call {
  at: string;
  agent: string;
  id: string;
  name: string;
  input: Json;
  cwd?: string;
}

interface Result {
  isError: boolean;
  text: string;
  data: Json;
}

/** A call and its result as the actions they amount to. */
function toActions(call: Call, result: Result): Action[] {
  const { input } = call;
  const data = result.data;
  switch (call.name) {
    case "Edit": {
      const path = str(input.file_path);
      if (!path) return [];
      const action: Action = {
        kind: "edit",
        path,
        // The result's strings are what was applied, if someone amended it.
        oldString: str(data.oldString) ?? str(input.old_string) ?? "",
        newString: str(data.newString) ?? str(input.new_string) ?? "",
        replaceAll: input.replace_all === true,
      };
      const seen = str(data.originalFile);
      if (seen !== undefined) action.seen = seen;
      return [action];
    }
    case "MultiEdit": {
      const path = str(input.file_path);
      if (!path || !Array.isArray(input.edits)) return [];
      const seen = str(data.originalFile);
      return input.edits.filter(isObject).map((edit, i) => {
        const action: Action = {
          kind: "edit",
          path,
          oldString: str(edit.old_string) ?? "",
          newString: str(edit.new_string) ?? "",
          replaceAll: edit.replace_all === true,
        };
        if (i === 0 && seen !== undefined) action.seen = seen;
        return action;
      });
    }
    case "Write": {
      const path = str(input.file_path);
      const content = str(input.content);
      if (!path || content === undefined) return [];
      const action: Action = { kind: "write", path, content };
      // `originalFile: null` means "did not exist" on a create — but newer
      // Claude Code also writes null when the file was not in the model's
      // context (`contentNotInModelContext`), which means "not recorded".
      const seen = str(data.originalFile);
      if (seen !== undefined) action.seen = seen;
      else if (data.type === "create") action.seen = null;
      else if ("originalFile" in data && data.contentNotInModelContext !== true)
        action.seen = null;
      return [action];
    }
    case "Bash": {
      const command = str(input.command);
      if (!command) return [];
      const printed = [str(data.stdout), str(data.stderr)]
        .filter((part): part is string => Boolean(part))
        .join("\n");
      const action: Action = {
        kind: "command",
        command,
        output: printed || result.text,
      };
      const description = str(input.description);
      if (description) action.description = description;
      return [action];
    }
    default:
      return [];
  }
}

/**
 * @param agent what to call the author of the main thread's entries; entries
 * marked `isSidechain` are attributed to their subagent instead.
 */
export function parseClaudeCode(jsonl: Log, agent = "main"): Transcript {
  const transcript: Transcript = { source: CLAUDE_CODE, events: [] };
  // Calls keep their place in the stream; results arrive later and are
  // folded into the call's action event once the whole log is read.
  const slots: (TranscriptEvent | Call)[] = [];
  const results = new Map<string, Result>();

  for (const entry of jsonLines(jsonl)) {
    const at = str(entry.timestamp) ?? "";
    if (at) {
      transcript.startedAt ??= at;
      transcript.endedAt = at;
    }
    transcript.sessionId ??= str(entry.sessionId);
    transcript.cwd ??= str(entry.cwd);
    if (str(entry.gitBranch)) transcript.branch ??= str(entry.gitBranch);

    const message = entry.message;
    if (!isObject(message)) continue;
    const who = entry.isSidechain === true ? (str(entry.agentId) ?? "subagent") : agent;
    const cwd = str(entry.cwd);
    const uuid = str(entry.uuid);

    if (entry.type === "user") {
      if (entry.isMeta === true || entry.isCompactSummary === true) continue;
      const content = message.content;
      if (typeof content === "string") {
        const text = cleanPrompt(content);
        if (text) slots.push({ type: "prompt", at, agent: who, uuid, text });
        continue;
      }
      if (!Array.isArray(content)) continue;
      const blocks = content.filter(
        (block) => isObject(block) && block.type === "tool_result",
      );
      for (const block of blocks) {
        if (!isObject(block) || typeof block.tool_use_id !== "string") continue;
        results.set(block.tool_use_id, {
          isError: block.is_error === true,
          text: textOf(block.content),
          // One result per entry is the norm; with several, the entry-level
          // data cannot be attributed, so none of them gets it.
          data:
            blocks.length === 1 && isObject(entry.toolUseResult)
              ? entry.toolUseResult
              : {},
        });
      }
      if (blocks.length === 0) {
        const text = cleanPrompt(textOf(content));
        if (text) slots.push({ type: "prompt", at, agent: who, uuid, text });
      }
      continue;
    }

    if (entry.type === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isObject(block)) continue;
        if (
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim()
        ) {
          slots.push({ type: "text", at, agent: who, uuid, text: block.text });
        } else if (
          block.type === "thinking" &&
          typeof block.thinking === "string" &&
          block.thinking.trim()
        ) {
          slots.push({ type: "thinking", at, agent: who, text: block.thinking });
        } else if (
          block.type === "tool_use" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
        ) {
          slots.push({
            at,
            agent: who,
            id: block.id,
            name: block.name,
            input: isObject(block.input) ? block.input : {},
            cwd,
          });
        }
      }
    }
  }

  for (const slot of slots) {
    if ("type" in slot) {
      transcript.events.push(slot);
      continue;
    }
    // No result: the session ended or was interrupted mid-call.
    const result = results.get(slot.id);
    if (!result) continue;
    const actions = toActions(slot, result);
    if (actions.length === 0) continue;
    const event: TranscriptEvent = {
      type: "action",
      at: slot.at,
      agent: slot.agent,
      id: slot.id,
      actions,
      failed: result.isError,
    };
    if (slot.cwd) event.cwd = slot.cwd;
    transcript.events.push(event);
  }
  return transcript;
}
