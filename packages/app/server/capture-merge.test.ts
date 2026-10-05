// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureSession } from "./capture.ts";
import { findSession } from "./sessions.ts";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "replay-merge-")));
const repo = join(temp, "repo");
const home = join(temp, "claude");
const SESSION = "0a1b2c3d-0000-4000-8000-0000000merge";
let base = "";

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
    { encoding: "utf8" },
  ).trim();
}

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "a.ts"), "x = 1\n");
  writeFileSync(join(repo, "shared.ts"), "one\ntwo\nthree\nfour\nfive\n");
  git("add", ".");
  git("commit", "-qm", "base");
  base = git("rev-parse", "HEAD");

  // Someone else lands work on main while the session runs on a branch.
  git("checkout", "-qb", "work");
  git("checkout", "-q", "main");
  writeFileSync(join(repo, "theirs.ts"), "y = 1\n");
  writeFileSync(join(repo, "shared.ts"), "ONE\ntwo\nthree\nfour\nfive\n");
  git("add", ".");
  git("commit", "-qm", "theirs");
  git("checkout", "-q", "work");

  // The session edits a.ts, changes shared.ts by a command (no edit tool
  // saw it — an install rewriting a lockfile, say), commits, then merges
  // main in, which changed shared.ts too.
  writeFileSync(join(repo, "a.ts"), "x = 2\n");
  writeFileSync(join(repo, "shared.ts"), "one\ntwo\nthree\nfour\nFIVE\n");
  git("commit", "-qam", "mine");
  git("merge", "-q", "--no-edit", "main");

  const at = (n: number) => new Date(Date.now() + 5_000 + 1_000 * n).toISOString();
  const line = (n: number, entry: object) =>
    JSON.stringify({ sessionId: SESSION, cwd: repo, timestamp: at(n), ...entry });
  mkdirSync(join(home, "projects", "p"), { recursive: true });
  writeFileSync(
    join(home, "projects", "p", `${SESSION}.jsonl`),
    [
      line(0, { type: "user", uuid: "p1", message: { content: "bump x" } }),
      line(1, {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "e1",
              name: "Edit",
              input: {
                file_path: join(repo, "a.ts"),
                old_string: "1",
                new_string: "2",
              },
            },
          ],
        },
      }),
      line(2, {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "e1", content: "ok" }],
        },
        toolUseResult: { originalFile: "x = 1\n" },
      }),
    ].join("\n"),
  );
});

afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("capture across a merge", () => {
  it("leaves out what a merge brought in and the session never touched", async () => {
    const session = findSession(SESSION, {
      claude: home,
      codex: join(temp, "none"),
      gemini: join(temp, "none"),
    })!;
    const { replay } = await captureSession({ session, root: repo, base });
    const paths = replay.steps.flatMap((s) => ("path" in s ? [s.path] : []));
    expect(paths).toContain("a.ts");
    expect(paths).not.toContain("theirs.ts");
  });

  it("keeps a file both sides changed, even when no edit tool saw the session's part", async () => {
    const session = findSession(SESSION, {
      claude: home,
      codex: join(temp, "none"),
      gemini: join(temp, "none"),
    })!;
    const { replay } = await captureSession({ session, root: repo, base });
    const paths = replay.steps.flatMap((s) => ("path" in s ? [s.path] : []));
    expect(paths).toContain("shared.ts");
  });
});

describe("capture across a fast-forward", () => {
  const ff = join(temp, "ff");
  const FF_SESSION = "0a1b2c3d-0000-4000-8000-00000000ffwd";
  let ffBase = "";
  const run = (...args: string[]) =>
    execFileSync(
      "git",
      ["-C", ff, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
      { encoding: "utf8" },
    ).trim();

  beforeAll(() => {
    mkdirSync(ff, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", ff]);
    writeFileSync(join(ff, "a.ts"), "x = 1\n");
    run("add", ".");
    run("commit", "-qm", "base");
    ffBase = run("rev-parse", "HEAD");
    run("checkout", "-qb", "work");
    run("checkout", "-q", "main");
    writeFileSync(join(ff, "theirs.ts"), "y = 1\n");
    run("add", ".");
    run("commit", "-qm", "theirs");
    // The session pulls main in before doing anything: a fast-forward.
    run("checkout", "-q", "work");
    run("merge", "-q", "--ff-only", "main");
    writeFileSync(join(ff, "a.ts"), "x = 2\n");
    run("commit", "-qam", "mine");

    const at = (n: number) => new Date(Date.now() + 5_000 + 1_000 * n).toISOString();
    const line = (n: number, entry: object) =>
      JSON.stringify({ sessionId: FF_SESSION, cwd: ff, timestamp: at(n), ...entry });
    writeFileSync(
      join(home, "projects", "p", `${FF_SESSION}.jsonl`),
      [
        line(0, { type: "user", uuid: "p1", message: { content: "bump x" } }),
        line(1, {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "e1",
                name: "Edit",
                input: {
                  file_path: join(ff, "a.ts"),
                  old_string: "1",
                  new_string: "2",
                },
              },
            ],
          },
        }),
        line(2, {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "e1", content: "ok" }],
          },
          toolUseResult: { originalFile: "x = 1\n" },
        }),
      ].join("\n"),
    );
  });

  it("leaves out what a fast-forward brought in", async () => {
    const session = findSession(FF_SESSION, {
      claude: home,
      codex: join(temp, "none"),
      gemini: join(temp, "none"),
    })!;
    const { replay } = await captureSession({ session, root: ff, base: ffBase });
    const paths = replay.steps.flatMap((s) => ("path" in s ? [s.path] : []));
    expect(paths).toContain("a.ts");
    expect(paths).not.toContain("theirs.ts");
  });
});
