/**
 * Builders for Claude Code transcript lines, shaped like the real thing
 * (`~/.claude/projects/<project>/<session>.jsonl`) but only as detailed as the
 * parser reads.
 */

export const ROOT = "/work/repo";

let clock = 0;

export function resetClock(): void {
  clock = 0;
}

function tick(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
}

function line(entry: Record<string, unknown>): string {
  return JSON.stringify({
    sessionId: "session-1",
    cwd: ROOT,
    gitBranch: "main",
    timestamp: tick(),
    ...entry,
  });
}

export function prompt(text: string): string {
  return line({
    type: "user",
    uuid: `u-${clock}`,
    message: { role: "user", content: text },
  });
}

export function say(text: string): string {
  return line({
    type: "assistant",
    uuid: `a-${clock}`,
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

export function call(id: string, name: string, input: Record<string, unknown>): string {
  return line({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
    },
  });
}

export function result(
  id: string,
  data: unknown,
  options: { error?: boolean; text?: string } = {},
): string {
  return line({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: options.text ?? "ok",
          ...(options.error ? { is_error: true } : {}),
        },
      ],
    },
    toolUseResult: data,
  });
}

/** An Edit call and its result, with `originalFile` as the tool saw it. */
export function edit(
  id: string,
  path: string,
  originalFile: string,
  oldString: string,
  newString: string,
): string[] {
  return [
    call(id, "Edit", {
      file_path: `${ROOT}/${path}`,
      old_string: oldString,
      new_string: newString,
      replace_all: false,
    }),
    result(id, {
      filePath: `${ROOT}/${path}`,
      oldString,
      newString,
      originalFile,
      replaceAll: false,
    }),
  ];
}

export function write(
  id: string,
  path: string,
  content: string,
  originalFile: string | null,
): string[] {
  return [
    call(id, "Write", { file_path: `${ROOT}/${path}`, content }),
    result(id, {
      type: originalFile === null ? "create" : "update",
      filePath: `${ROOT}/${path}`,
      content,
      originalFile,
    }),
  ];
}

export function bash(id: string, command: string, stdout = ""): string[] {
  return [
    call(id, "Bash", { command, description: `run ${id}` }),
    result(id, { stdout, stderr: "", interrupted: false }),
  ];
}
