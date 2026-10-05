// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { play } from "@agent-replay/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureSession, repoRoots } from "./capture.ts";
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
  it("replays a session from its base commit to the working tree", async () => {
    const session = findSession(SESSION);
    expect(session?.title).toBe("Bump x, drop b, add c");
    const { replay, root, warnings } = await captureSession({ session: session! });
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

  it("saves one file per session and keeps notes across re-captures", async () => {
    const session = findSession(SESSION)!;
    const first = await captureSession({ session, title: "Bump x" });
    saveReplay(first.root, {
      ...first.replay,
      notes: { e1: { level: "review", text: "Check the bump." } },
    });
    const again = await captureSession({ session });
    const name = findSaved(again.root, SESSION)!;
    expect(name).toBe(`${name.slice(0, 10)}-bump-x-${idKey(SESSION)}`);
    expect(again.replay.title).toBe("Bump x");
    expect(again.replay.notes).toEqual({
      e1: { level: "review", text: "Check the bump." },
    });
    expect(readReplay(again.root, name)?.id).toBe(SESSION);
  });

  it("keeps two sessions whose ids share a prefix apart", async () => {
    // UUIDv7 (Codex): the first eight characters are a timestamp's.
    const session = findSession(SESSION)!;
    const { replay, root } = await captureSession({ session, title: "Twin" });
    const a = { ...replay, id: "0199dd8e-1111-7000-8000-000000000001" };
    const b = { ...replay, id: "0199dd8e-2222-7000-8000-000000000002" };
    saveReplay(root, a);
    saveReplay(root, b);
    expect(readReplay(root, findSaved(root, a.id)!)?.id).toBe(a.id);
    expect(readReplay(root, findSaved(root, b.id)!)?.id).toBe(b.id);
  });

  it("places a file edited by hand when it was written, between the prompts around it", async () => {
    const dir = join(temp, "timed");
    const id = "0e1f2a3b-0000-4000-8000-000000000003";
    const at = (seconds: number) => new Date(start + seconds * 1000);
    const line = (seconds: number, entry: object) =>
      JSON.stringify({ sessionId: id, cwd: dir, timestamp: at(seconds), ...entry });
    const commit = (...args: string[]) =>
      execFileSync("git", [
        "-C",
        dir,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        ...args,
      ]);
    mkdirSync(dir, { recursive: true });
    execFileSync("git", ["init", "-q", dir]);
    writeFileSync(join(dir, "notes.md"), "draft\n");
    commit("add", ".");
    commit("commit", "-qm", "base");
    // After the commit, so the base is the commit whatever the clock says.
    const start = Date.now() + 60_000;
    mkdirSync(join(home, "projects", "timed"), { recursive: true });
    writeFileSync(
      join(home, "projects", "timed", `${id}.jsonl`),
      [
        line(0, { type: "user", uuid: "p1", message: { content: "Read the notes" } }),
        line(1, {
          type: "assistant",
          uuid: "a1",
          message: { content: [{ type: "text", text: "They are a draft." }] },
        }),
        line(20, { type: "user", uuid: "p2", message: { content: "Read them again" } }),
        line(21, {
          type: "assistant",
          uuid: "a2",
          message: { content: [{ type: "text", text: "They are final now." }] },
        }),
      ].join("\n"),
    );
    // Written by hand between the two prompts: no recorded call explains it.
    writeFileSync(join(dir, "notes.md"), "final\n");
    utimesSync(join(dir, "notes.md"), at(10), at(10));

    const { replay } = await captureSession({ session: findSession(id)! });
    const ids = replay.steps.map((step) => step.id);
    const edit = ids.indexOf("untracked:notes.md");
    expect(edit).toBeGreaterThan(ids.indexOf("prompt:p1"));
    expect(edit).toBeLessThan(ids.indexOf("prompt:p2"));
    expect(
      Math.abs(Date.parse(replay.steps[edit]!.at) - at(10).getTime()),
    ).toBeLessThan(1000);
  });
});

describe("repoRoots", () => {
  it("asks git once per directory, and knows a top level as its own", () => {
    const top = join(temp, "roots");
    mkdirSync(join(top, "src"), { recursive: true });
    execFileSync("git", ["init", "-q", top]);
    const repoRoot = repoRoots();
    const found = repoRoot(join(top, "src"));
    expect(found).toBe(
      execFileSync("git", ["-C", top, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
      }).trim(),
    );
    // With the repository gone, only answers already given can still name it.
    rmSync(join(top, ".git"), { recursive: true, force: true });
    expect(repoRoot(join(top, "src"))).toBe(found);
    expect(repoRoot(found!)).toBe(found);
    expect(repoRoots()(join(top, "src"))).toBeUndefined();
  });
});
