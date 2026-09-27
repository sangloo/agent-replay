// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureHistory } from "./history.ts";
import { saveReplay } from "./store.ts";

const repo = realpathSync(mkdtempSync(join(tmpdir(), "replay-history-")));

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
    {
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-02T03:04:05Z" },
    },
  ).trim();
}

let first = "";

beforeAll(() => {
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "first");
  first = git("rev-parse", "HEAD");
  writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
  git("commit", "-qam", "second");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("captureHistory", () => {
  it("dates a learning replay by where it starts, even with no commits after", () => {
    const head = git("rev-parse", "HEAD");
    const { replay } = captureHistory({
      root: repo,
      from: head,
      to: head,
      learn: true,
    });
    expect(replay.repo.commits).toHaveLength(0);
    expect(replay.startedAt).toMatch(/^2026-01-02T03:04:05/);
  });

  it("keeps the notes and title of the replay it replaces", () => {
    const { replay } = captureHistory({ root: repo, from: first });
    const step = replay.steps.find((s) => s.kind === "commit")!;
    replay.notes[step.id] = { level: "info", text: "The value moves to 2." };
    replay.title = "Renamed by hand";
    saveReplay(repo, replay);

    const again = captureHistory({ root: repo, from: first }).replay;
    expect(again.notes[step.id]?.text).toBe("The value moves to 2.");
    expect(again.title).toBe("Renamed by hand");
    expect(captureHistory({ root: repo, from: first, title: "New" }).replay.title).toBe(
      "New",
    );
  });
});
