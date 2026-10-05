import { describe, expect, it } from "vitest";

import { capture } from "../capture.ts";
import { play } from "../play.ts";
import { detectAdapter, parseTranscript } from "./index.ts";

const ROOT = "/home/me/repo";

/** Shaped after codex-rs's rollout serde types (current and older eras). */
const CODEX_LOG = [
  {
    type: "session_meta",
    payload: { id: "0199-codex", cwd: ROOT, git: { branch: "main" } },
  },
  { type: "turn_context", payload: { cwd: ROOT, model: "gpt-5" } },
  {
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "<environment_context>cwd</environment_context>" },
      ],
    },
  },
  {
    type: "event_msg",
    payload: { type: "user_message", message: "rename foo to bar", kind: "plain" },
  },
  {
    type: "response_item",
    payload: {
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Find foo first." }],
    },
  },
  {
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "rg -n foo", workdir: ROOT }),
      call_id: "c1",
    },
  },
  {
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "c1",
      output:
        "Chunk ID: 1\nWall time: 0.02 seconds\nProcess exited with code 0\nOutput:\nsrc/a.ts:1:foo()\n",
    },
  },
  {
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Renaming it." }],
    },
  },
  {
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      status: "completed",
      call_id: "c2",
      name: "apply_patch",
      input:
        "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-foo()\n+bar()\n*** Add File: src/b.ts\n+export {};\n*** End Patch\n",
    },
  },
  {
    type: "event_msg",
    payload: { type: "patch_apply_end", call_id: "c2", success: true },
  },
  {
    type: "response_item",
    payload: {
      type: "custom_tool_call_output",
      call_id: "c2",
      output: "Success. Updated the following files:\nM src/a.ts\nA src/b.ts",
    },
  },
  {
    type: "response_item",
    payload: {
      type: "function_call",
      name: "shell",
      arguments: JSON.stringify({
        command: ["bash", "-lc", "pnpm test"],
        workdir: ROOT,
      }),
      call_id: "c3",
    },
  },
  {
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "c3",
      output: JSON.stringify({ output: "1 failed", metadata: { exit_code: 1 } }),
    },
  },
]
  .map((line, i) =>
    JSON.stringify({
      timestamp: `2026-09-20T14:02:${String(10 + i).padStart(2, "0")}.000Z`,
      ...line,
    }),
  )
  .join("\n");

/** Gemini CLI's JSONL records, including a re-appended message and a rewind. */
const GEMINI_LOG = [
  {
    sessionId: "gem-1",
    projectHash: "abc",
    startTime: "2026-04-01T22:01:58.817Z",
    kind: "main",
    directories: [ROOT],
  },
  {
    id: "u1",
    timestamp: "2026-04-01T22:02:01.000Z",
    type: "user",
    content: [{ text: "Add a greeting" }],
  },
  {
    id: "g1",
    timestamp: "2026-04-01T22:02:02.000Z",
    type: "gemini",
    content: "Working",
    toolCalls: [],
  },
  {
    id: "g1",
    timestamp: "2026-04-01T22:02:02.000Z",
    type: "gemini",
    content: "Editing the module.",
    thoughts: [{ subject: "Plan", description: "One replace." }],
    toolCalls: [
      {
        id: "t1",
        name: "replace",
        args: { file_path: `${ROOT}/src/a.ts`, old_string: "hi", new_string: "hello" },
        status: "success",
        resultDisplay: { originalContent: "say('hi')\n", isNewFile: false },
      },
      {
        id: "t2",
        name: "run_shell_command",
        args: { command: "npm test", description: "Run tests" },
        result: [
          {
            functionResponse: {
              id: "t2",
              name: "run_shell_command",
              response: { output: "Output: ok\nExit Code: 0" },
            },
          },
        ],
        status: "success",
      },
    ],
  },
  {
    id: "u2",
    timestamp: "2026-04-01T22:03:00.000Z",
    type: "user",
    content: [{ text: "Undo that" }],
  },
  { $rewindTo: "u2" },
]
  .map((record) => JSON.stringify(record))
  .join("\n");

describe("detectAdapter", () => {
  it("tells the agents apart by their first lines", () => {
    expect(detectAdapter(CODEX_LOG)?.id).toBe("codex");
    expect(detectAdapter(GEMINI_LOG)?.id).toBe("gemini-cli");
    expect(
      detectAdapter(
        JSON.stringify({ type: "user", sessionId: "s", message: { content: "x" } }),
      )?.id,
    ).toBe("claude-code");
  });
});

describe("codex", () => {
  const transcript = parseTranscript(CODEX_LOG);

  it("reads typed prompts, not injected context", () => {
    expect(transcript.sessionId).toBe("0199-codex");
    expect(transcript.branch).toBe("main");
    const prompts = transcript.events.filter((e) => e.type === "prompt");
    expect(prompts).toMatchObject([{ text: "rename foo to bar" }]);
  });

  it("turns exec_command, apply_patch and the older shell into actions", () => {
    const actions = transcript.events.filter((e) => e.type === "action");
    expect(
      actions.map((e) => e.type === "action" && [e.id, e.actions[0]!.kind, e.failed]),
    ).toEqual([
      ["c1", "command", false],
      ["c2", "patch", false],
      ["c3", "command", true],
    ]);
    const first = actions[0];
    expect(first?.type === "action" && first.actions[0]).toMatchObject({
      command: "rg -n foo",
      output: "src/a.ts:1:foo()\n",
    });
    const patch = actions[1];
    expect(patch?.type === "action" && patch.actions[0]).toMatchObject({
      files: [
        { op: "update", path: `${ROOT}/src/a.ts` },
        { op: "add", path: `${ROOT}/src/b.ts` },
      ],
    });
  });

  it("replays through capture to the patched end state", () => {
    const replay = capture([transcript], {
      root: ROOT,
      repo: { name: "repo", commits: [] },
      readBase: (path) => (path === "src/a.ts" ? "foo()\n" : null),
    });
    expect(replay.source).toBe("codex");
    const playback = play(replay);
    expect(playback.contentAt("src/a.ts", playback.length)).toBe("bar()\n");
    expect(playback.contentAt("src/b.ts", playback.length)).toBe("export {};\n");
    const edit = replay.steps.find((s) => s.kind === "edit");
    expect(edit).toMatchObject({
      why: "Renaming it.",
      oldString: "foo()\n",
      newString: "bar()\n",
    });
  });
});

describe("gemini-cli", () => {
  const transcript = parseTranscript(GEMINI_LOG);

  it("keeps the last copy of a message and honours rewinds", () => {
    expect(transcript.sessionId).toBe("gem-1");
    expect(transcript.cwd).toBe(ROOT);
    const prompts = transcript.events.filter((e) => e.type === "prompt");
    expect(prompts).toMatchObject([{ text: "Add a greeting" }]);
    expect(transcript.events.filter((e) => e.type === "text")).toMatchObject([
      { text: "Editing the module." },
    ]);
  });

  it("carries the file each edit found, for drift detection", () => {
    const replay = capture([transcript], {
      root: ROOT,
      repo: { name: "repo", commits: [] },
      readBase: () => "say('hi')\n",
    });
    expect(replay.steps.map((s) => s.kind)).toEqual(["prompt", "edit", "command"]);
    const playback = play(replay);
    expect(playback.contentAt("src/a.ts", playback.length)).toBe("say('hello')\n");
  });

  it("reads the older single-object .json format too", () => {
    const whole = JSON.stringify({
      sessionId: "gem-2",
      projectHash: "abc",
      startTime: "2026-01-01T00:00:00Z",
      messages: [
        { id: "u1", timestamp: "2026-01-01T00:00:01Z", type: "user", content: "hi" },
      ],
    });
    const parsed = parseTranscript(whole);
    expect(parsed.source).toBe("gemini-cli");
    expect(parsed.events).toMatchObject([{ type: "prompt", text: "hi" }]);
  });
});

describe("claude-code", () => {
  const line = (entry: object) =>
    JSON.stringify({
      sessionId: "s",
      cwd: ROOT,
      timestamp: "2026-09-26T10:00:00Z",
      ...entry,
    });
  const write = (id: string, result: object) => [
    line({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id,
            name: "Write",
            input: { file_path: `${ROOT}/a.ts`, content: "x\n" },
          },
        ],
      },
    }),
    line({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
      toolUseResult: result,
    }),
  ];
  const seenBy = (result: object) => {
    const transcript = parseTranscript(write("w1", result).join("\n"));
    const event = transcript.events.find((e) => e.type === "action");
    const action = event?.type === "action" ? event.actions[0] : undefined;
    return action?.kind === "write" ? action.seen : "no action";
  };

  it("reads a null original as absent on a create, unknown when it was not recorded", () => {
    expect(seenBy({ type: "create", originalFile: null })).toBeNull();
    expect(seenBy({ type: "update", originalFile: "old\n" })).toBe("old\n");
    expect(
      seenBy({ type: "update", originalFile: null, contentNotInModelContext: true }),
    ).toBeUndefined();
  });
});

it("reports unsupported orchestrator calls without retaining their output as replay actions", () => {
  const lines = [
    CODEX_LOG[0],
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        call_id: "wrapped",
        input: "await tools.exec_command({cmd:'pwd'})",
      },
    },
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "wrapped",
        output: "large unknown output",
      },
    },
  ].map((line) => JSON.stringify(line));
  const transcript = parseTranscript({
    *[Symbol.iterator]() {
      yield* lines;
    },
  });
  expect(transcript.unsupportedTools).toBe(1);
  expect(transcript.events).toEqual([]);
});
