import { describe, expect, it } from "vitest";

import type { Replay } from "./format.ts";
import { play } from "./play.ts";

const replay: Replay = {
  version: 1,
  id: "s",
  title: "t",
  source: "claude-code",
  startedAt: "",
  endedAt: "",
  repo: { name: "repo", commits: [] },
  files: { "a.ts": "one\ntwo\n", "b.ts": null, "c.ts": "gone\n" },
  omitted: [],
  notes: {},
  steps: [
    { kind: "prompt", id: "p", at: "", agent: "main", turn: 0, text: "go" },
    {
      kind: "edit",
      id: "e1",
      at: "",
      agent: "main",
      turn: 0,
      path: "a.ts",
      oldString: "two",
      newString: "TWO",
      replaceAll: false,
    },
    {
      kind: "write",
      id: "w1",
      at: "",
      agent: "main",
      turn: 0,
      path: "b.ts",
      content: "new\n",
    },
    {
      kind: "external",
      id: "x1",
      at: "",
      agent: "main",
      turn: 0,
      path: "c.ts",
      content: null,
      reason: "untracked",
    },
    {
      kind: "edit",
      id: "e2",
      at: "",
      agent: "main",
      turn: 0,
      path: "a.ts",
      oldString: "missing",
      newString: "x",
      replaceAll: false,
    },
  ],
};

describe("play", () => {
  const playback = play(replay);

  it("gives every file's content at every cursor", () => {
    expect(playback.contentAt("a.ts", 0)).toBe("one\ntwo\n");
    expect(playback.contentAt("a.ts", 1)).toBe("one\ntwo\n");
    expect(playback.contentAt("a.ts", 2)).toBe("one\nTWO\n");
    expect(playback.contentAt("b.ts", 2)).toBeNull();
    expect(playback.contentAt("b.ts", 3)).toBe("new\n");
    expect(playback.contentAt("c.ts", 4)).toBeNull();
  });

  it("reports hunks in before coordinates", () => {
    expect(playback.frames[1]!.change).toMatchObject({
      hunks: [{ at: 4, remove: "two", insert: "TWO" }],
      added: 1,
      removed: 1,
      applied: true,
    });
  });

  it("marks a step that cannot apply and leaves the file alone", () => {
    expect(playback.frames[4]!.change).toMatchObject({ applied: false });
    expect(playback.contentAt("a.ts", 5)).toBe("one\nTWO\n");
  });

  it("gives each file's status relative to the base", () => {
    const at = (cursor: number) =>
      Object.fromEntries(
        playback.filesAt(cursor).map((f) => [f.path, [f.status, f.touched, f.absent]]),
      );
    expect(at(0)).toEqual({
      "a.ts": ["unchanged", false, false],
      "b.ts": ["unchanged", false, true],
      "c.ts": ["unchanged", false, false],
    });
    expect(at(5)).toEqual({
      "a.ts": ["modified", true, false],
      "b.ts": ["added", true, false],
      "c.ts": ["deleted", true, false],
    });
  });

  it("follows the most recent change", () => {
    expect(playback.focusAt(0)).toBeUndefined();
    expect(playback.focusAt(1)).toBeUndefined();
    expect(playback.focusAt(3)).toBe("b.ts");
    expect(playback.focusAt(99)).toBe("a.ts");
  });

  it("knows which step last wrote each line", () => {
    expect(playback.blameAt("a.ts", 0)).toEqual([-1, -1]);
    expect(playback.blameAt("a.ts", 2)).toEqual([-1, 1]);
    expect(playback.blameAt("b.ts", 3)).toEqual([2]);
    expect(playback.blameAt("c.ts", 4)).toEqual([]);
  });

  it("totals the net change", () => {
    expect(playback.totals).toEqual({ added: 2, removed: 2, files: 3 });
  });
});
