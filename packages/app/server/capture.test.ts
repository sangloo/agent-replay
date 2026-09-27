// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { play } from "@agent-replay/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureSession } from "./capture.ts";
import { findSession } from "./sessions.ts";
import { findSaved, idKey, readReplay, saveReplay } from "./store.ts";

const temp = mkdtempSync(join(tmpdir(), "replay-"));
const repo = join(temp, "repo");
const home = join(temp, "claude");
const SESSION = "0a1b2c3d-0000-4000-8000-000000000001";
let base = "";

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
    {
      encoding: "utf8",
    },
  ).trim();
}

function transcript(): string {
  let second = 0;
  const at = () => new Date(Date.now() + 5_000 + 1_000 * second++).toISOString();
  const line = (entry: object) =>
    JSON.stringify({ sessionId: SESSION, cwd: repo, timestamp: at(), ...entry });
  const call = (id: string, name: string, input: object) =>
    line({
      type: "assistant",
      message: { content: [{ type: "tool_use", id, name, input }] },
    });
  const result = (id: string, data: object) =>
    line({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
      toolUseResult: data,
    });
  return [
    line({ type: "user", uuid: "p1", message: { content: "Bump x, drop b, add c" } }),
    line({
      type: "assistant",
      uuid: "a1",
      message: { content: [{ type: "text", text: "Bumping x." }] },
    }),
    call("e1", "Edit", {
      file_path: join(repo, "a.ts"),
      old_string: "1",
      new_string: "2",
    }),
    result("e1", { originalFile: "x = 1\n", oldString: "1", newString: "2" }),
    call("b1", "Bash", { command: "rm b.ts && echo hi > c.txt" }),
    result("b1", { stdout: "", stderr: "" }),
  ].join("\n");
}

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "a.ts"), "x = 1\n");
  writeFileSync(join(repo, "b.ts"), "b\n");
  git("add", ".");
  git("commit", "-qm", "base");
  base = git("rev-parse", "HEAD");
  // What the session did to the working tree.
  writeFileSync(join(repo, "a.ts"), "x = 2\n");
  rmSync(join(repo, "b.ts"));
  writeFileSync(join(repo, "c.txt"), "hi\n");

  mkdirSync(join(home, "projects", "p"), { recursive: true });
  writeFileSync(join(home, "projects", "p", `${SESSION}.jsonl`), transcript());
  process.env.CLAUDE_CONFIG_DIR = home;
});

afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  rmSync(temp, { recursive: true, force: true });
});

describe("captureSession", () => {
  it("replays a session from its base commit to the working tree", () => {
    const session = findSession(SESSION);
    expect(session?.title).toBe("Bump x, drop b, add c");
    const { replay, root, warnings } = captureSession({ session: session! });
    expect(warnings).toEqual([]);
    expect(root).toBe(git("rev-parse", "--show-toplevel"));
    expect(replay.repo).toMatchObject({ name: "repo", base, dirty: true, commits: [] });
    expect(replay.steps.map((step) => step.id)).toEqual([
      "prompt:p1",
      "e1",
      "b1",
      "untracked:b.ts",
      "untracked:c.txt",
    ]);
    expect(replay.steps[1]).toMatchObject({ why: "Bumping x." });

    const playback = play(replay);
    for (const path of ["a.ts", "b.ts", "c.txt"]) {
      const actual = existsSync(join(repo, path))
        ? readFileSync(join(repo, path), "utf8")
        : null;
      expect(playback.contentAt(path, playback.length)).toBe(actual);
    }
  });

  it("saves one file per session and keeps notes across re-captures", () => {
    const session = findSession(SESSION)!;
    const first = captureSession({ session, title: "Bump x" });
    saveReplay(first.root, {
      ...first.replay,
      notes: { e1: { level: "review", text: "Check the bump." } },
    });
    const again = captureSession({ session });
    const name = findSaved(again.root, SESSION)!;
    expect(name).toBe(`${name.slice(0, 10)}-bump-x-${idKey(SESSION)}`);
    expect(again.replay.title).toBe("Bump x");
    expect(again.replay.notes).toEqual({
      e1: { level: "review", text: "Check the bump." },
    });
    expect(readReplay(again.root, name)?.id).toBe(SESSION);
  });

  it("keeps two sessions whose ids share a prefix apart", () => {
    // UUIDv7 (Codex): the first eight characters are a timestamp's.
    const session = findSession(SESSION)!;
    const { replay, root } = captureSession({ session, title: "Twin" });
    const a = { ...replay, id: "0199dd8e-1111-7000-8000-000000000001" };
    const b = { ...replay, id: "0199dd8e-2222-7000-8000-000000000002" };
    saveReplay(root, a);
    saveReplay(root, b);
    expect(readReplay(root, findSaved(root, a.id)!)?.id).toBe(a.id);
    expect(readReplay(root, findSaved(root, b.id)!)?.id).toBe(b.id);
  });
});
