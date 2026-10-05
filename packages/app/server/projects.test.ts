// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { folderName, replayFolders } from "./projects.ts";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "replay-projects-")));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());

function folders(root: string, ...paths: string[]) {
  for (const path of paths) mkdirSync(join(root, path), { recursive: true });
}

describe("replayFolders", () => {
  it("finds replays kept in folders nested in a project, the project's own first", () => {
    const root = join(temp, "app");
    folders(
      root,
      ".replays",
      "tutorials/backend/.replays",
      "packages/web/.replays",
      "a/b/c/d/.replays",
    );
    expect(replayFolders(root)).toEqual([
      root,
      join(root, "a/b/c/d"),
      join(root, "packages/web"),
      join(root, "tutorials/backend"),
    ]);
  });

  it("stays out of dependencies, hidden folders, links and the depths", () => {
    const root = join(temp, "busy");
    folders(
      root,
      "node_modules/pkg/.replays",
      "vendor/lib/.replays",
      ".git/modules/x/.replays",
      ".claude/worktrees/copy/.replays",
      "a/b/c/d/e/.replays",
      "kept/.replays",
    );
    folders(temp, "outside/.replays");
    symlinkSync(join(temp, "outside"), join(root, "linked"));
    expect(replayFolders(root)).toEqual([root, join(root, "kept")]);
  });

  it("answers for a project without replays, or not there at all, with the project", () => {
    const root = join(temp, "plain");
    folders(root, "src/lib");
    expect(replayFolders(root)).toEqual([root]);
    const missing = join(temp, "missing");
    expect(replayFolders(missing)).toEqual([missing]);
  });

  it("keeps an answer a little while, then looks again", () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T10:00:00Z") });
    const root = join(temp, "growing");
    folders(root, "one/.replays");
    expect(replayFolders(root)).toEqual([root, join(root, "one")]);
    folders(root, "two/.replays");
    expect(replayFolders(root)).toEqual([root, join(root, "one")]);
    vi.setSystemTime(new Date("2026-10-01T10:00:20Z"));
    expect(replayFolders(root)).toEqual([root, join(root, "one"), join(root, "two")]);
  });
});

describe("folderName", () => {
  it("names a nested folder from its project", () => {
    expect(folderName("/code/app", "/code/app")).toBe("app");
    expect(folderName("/code/app", "/code/app/tutorials/backend")).toBe(
      "app/tutorials/backend",
    );
  });
});
