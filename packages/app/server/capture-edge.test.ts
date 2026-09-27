// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureSession } from "./capture.ts";
import { findSession } from "./sessions.ts";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "replay-edge-")));
const repo = join(temp, "repo");
const link = join(temp, "linked");
const home = join(temp, "claude");
const SESSION = "0a1b2c3d-0000-4000-8000-00000000edge";

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, ".gitignore"), ".env.local\n");
  writeFileSync(join(repo, "a.ts"), "x = 1\n");
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
  symlinkSync(repo, link);
  writeFileSync(join(repo, "a.ts"), "x = 2\n");
  writeFileSync(join(repo, ".env.local"), "SECRET=hunter2\n");

  // The agent worked through the symlink, and wrote a gitignored secret.
  let second = 0;
  const at = () => new Date(Date.now() + 5_000 + 1_000 * second++).toISOString();
  const line = (entry: object) =>
    JSON.stringify({ sessionId: SESSION, cwd: link, timestamp: at(), ...entry });
  const result = (id: string, data: object) =>
    line({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
      toolUseResult: data,
    });
  const call = (id: string, name: string, input: object) =>
    line({
      type: "assistant",
      message: { content: [{ type: "tool_use", id, name, input }] },
    });
  mkdirSync(join(home, "projects", "p"), { recursive: true });
  writeFileSync(
    join(home, "projects", "p", `${SESSION}.jsonl`),
    [
      line({ type: "user", uuid: "p1", message: { content: "bump and configure" } }),
      call("e1", "Edit", {
        file_path: join(link, "a.ts"),
        old_string: "1",
        new_string: "2",
      }),
      result("e1", { originalFile: "x = 1\n" }),
      call("w1", "Write", {
        file_path: join(link, ".env.local"),
        content: "SECRET=hunter2\n",
      }),
      result("w1", { type: "create", originalFile: null }),
    ].join("\n"),
  );
});

afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("capture at the edges", () => {
  const homes = () => ({
    claude: home,
    codex: join(temp, "none"),
    gemini: join(temp, "none"),
  });

  it("keeps edits made through a symlinked path as edits", () => {
    const session = findSession(SESSION, homes())!;
    const { replay } = captureSession({ session, root: repo });
    expect(replay.steps.find((s) => s.id === "e1")).toMatchObject({
      kind: "edit",
      path: "a.ts",
    });
    expect(replay.steps.some((s) => s.kind === "external" && s.path === "a.ts")).toBe(
      false,
    );
  });

  it("never stores a gitignored file's content", () => {
    const session = findSession(SESSION, homes())!;
    const { replay } = captureSession({ session, root: repo });
    expect(replay.omitted).toContain(".env.local");
    expect(JSON.stringify(replay)).not.toContain("hunter2");
  });
});
