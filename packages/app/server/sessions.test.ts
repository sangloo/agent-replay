// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";

import { play } from "@agent-replay/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureSession } from "./capture.ts";
import { findSession, listSessions } from "./sessions.ts";

const temp = mkdtempSync(join(tmpdir(), "replay-agents-"));
const home = join(temp, "home");
const repo = join(temp, "repo");
const later = (s: number) => new Date(Date.now() + 5_000 + s * 1_000).toISOString();

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "a.ts"), "foo()\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-qm",
    "base",
  ]);
  writeFileSync(join(repo, "a.ts"), "bar()\n");

  // Codex, a week old and so compressed.
  const rollout = [
    { type: "session_meta", payload: { id: "codex-thread-1", cwd: repo } },
    { type: "event_msg", payload: { type: "user_message", message: "rename foo" } },
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        call_id: "c1",
        name: "apply_patch",
        input:
          "*** Begin Patch\n*** Update File: a.ts\n@@\n-foo()\n+bar()\n*** End Patch",
      },
    },
    {
      type: "response_item",
      payload: { type: "custom_tool_call_output", call_id: "c1", output: "Success." },
    },
  ]
    .map((line, i) => JSON.stringify({ timestamp: later(i), ...line }))
    .join("\n");
  const day = join(home, ".codex", "sessions", "2026", "09", "20");
  mkdirSync(day, { recursive: true });
  writeFileSync(
    join(day, "rollout-2026-09-20T14-02-11-codex-thread-1.jsonl.zst"),
    zstdCompressSync(Buffer.from(rollout)),
  );

  // Gemini, whose project path lives beside its chats.
  const project = join(home, ".gemini", "tmp", "repo");
  mkdirSync(join(project, "chats"), { recursive: true });
  writeFileSync(join(project, ".project_root"), repo);
  writeFileSync(
    join(project, "chats", "session-2026-09-20T14-05-gem00001.jsonl"),
    [
      { sessionId: "gem00001-full", projectHash: "h", startTime: later(0) },
      {
        id: "u1",
        timestamp: later(1),
        type: "user",
        content: [{ text: "look around" }],
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n"),
  );
});

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

const homes = () => ({
  claude: join(home, ".claude"),
  codex: join(home, ".codex"),
  gemini: join(home, ".gemini"),
});

describe("sessions from every agent", () => {
  it("lists Codex (compressed) and Gemini sessions with their agent and directory", () => {
    const sessions = listSessions(100, homes());
    const byAgent = Object.fromEntries(sessions.map((s) => [s.agent, s]));
    expect(byAgent.codex).toMatchObject({
      id: "codex-thread-1",
      cwd: repo,
      title: "rename foo",
    });
    expect(byAgent["gemini-cli"]).toMatchObject({
      id: "gem00001-full",
      cwd: repo,
      title: "look around",
    });
    expect(findSession("gem00001", homes())?.agent).toBe("gemini-cli");
  });

  it("captures a Codex session end to end", () => {
    const session = findSession("codex-thread-1", homes())!;
    const { replay } = captureSession({ session });
    expect(replay.source).toBe("codex");
    expect(replay.steps.map((s) => s.kind)).toEqual(["prompt", "edit"]);
    const playback = play(replay);
    expect(playback.contentAt("a.ts", playback.length)).toBe("bar()\n");
  });
});
