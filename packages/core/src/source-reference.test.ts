import { describe, expect, it } from "vitest";
import {
  parseSourceReference,
  sourceReferenceIndex,
  validSourceRanges,
} from "./source-reference.ts";
import type { Replay, Step } from "./format.ts";
const step = (fields: Record<string, unknown>) =>
  ({ id: "x", at: "", agent: "main", turn: 0, ...fields }) as Step;
function course(steps: Step[]): Replay {
  return {
    version: 1,
    id: "test",
    title: "Test",
    source: "course",
    startedAt: "",
    endedAt: "",
    repo: { name: "r", commits: [] },
    files: {},
    omitted: [],
    notes: {},
    course: { rev: "abc", sources: { "a.go": { lineCount: 9, sha256: "hash" } } },
    steps,
  };
}
describe("source references", () => {
  it("parses only bounded repository-relative line references", () => {
    expect(parseSourceReference("source:pkg/a.go#L3-L6")).toEqual({
      path: "pkg/a.go",
      lines: [3, 6],
    });
    for (const bad of [
      "source:../a.go#L1",
      "source:%2e%2e/a#L1",
      "source:/a.go#L1",
      "source:a\\b#L1",
      "source:a%00b#L1",
      "source://evil/a#L1",
      "source:a#L8-L2",
      "source:a#L9007199254740993",
      "javascript:alert(1)",
    ])
      expect(parseSourceReference(bad)).toBeUndefined();
  });
  it("maps original lines and refuses omitted gaps, rather than searching repeated text", () => {
    const replay = course([
      step({
        kind: "write",
        path: "a.go",
        content: "same\n}\nsame\n}\n",
        sourceLines: [
          [1, 2],
          [8, 9],
        ],
      }),
    ]);
    const index = sourceReferenceIndex(replay);
    expect(index.resolve("source:a.go#L8-L9", 1)).toMatchObject({
      destination: {
        displayed: [3, 4],
        lines: [8, 9],
        cursor: 1,
        preview: "same\n}\n",
      },
    });
    expect(index.resolve("source:a.go#L2-L8", 1)).toHaveProperty("reason");
    expect(index.resolve("source:a.go#L10", 1)).toHaveProperty("reason");
  });
  it("can navigate to a future complete excerpt and preserves the current cursor when available", () => {
    const replay = course([
      step({ kind: "write", path: "a.go", content: "one\n", sourceLines: [[1, 1]] }),
      step({
        kind: "write",
        path: "a.go",
        content: "one\ntwo\nthree\n",
        sourceLines: [[1, 3]],
      }),
      step({ kind: "explain", text: "Look" }),
    ]);
    expect(sourceReferenceIndex(replay).resolve("source:a.go#L2-L3", 1)).toMatchObject({
      destination: { cursor: 2, displayed: [2, 3] },
    });
    expect(sourceReferenceIndex(replay).resolve("source:a.go#L2-L3", 3)).toMatchObject({
      destination: { cursor: 3 },
    });
  });
  it("never carries provenance through a handwritten edit or example", () => {
    const replay = course([
      step({
        kind: "write",
        path: "a.go",
        content: "original\n",
        sourceLines: [[1, 1]],
      }),
      step({ kind: "write", path: "a.go", content: "invented\n" }),
      step({
        kind: "write",
        path: "b.go",
        content: "example\n",
        sourceLines: [[1, 1]],
        aside: true,
      }),
    ]);
    expect(sourceReferenceIndex(replay).resolve("source:a.go#L1", 2)).toMatchObject({
      destination: { cursor: 1, preview: "original\n" },
    });
    expect(sourceReferenceIndex(replay).resolve("source:b.go#L1", 3)).toHaveProperty(
      "reason",
    );
  });
  it("accepts older courses while refusing to invent their mapping", () => {
    const replay = course([step({ kind: "write", path: "a.go", content: "old\n" })]);
    delete replay.course!.sources;
    expect(sourceReferenceIndex(replay).resolve("source:a.go#L1", 1)).toHaveProperty(
      "reason",
    );
  });
  it("counts only current mapped source against all selected target files", () => {
    const replay = course([
      step({ kind: "write", path: "a.go", content: "one\n", sourceLines: [[1, 1]] }),
      step({ kind: "write", path: "a.go", content: "draft\n" }),
    ]);
    replay.course!.sources!["b.go"] = { lineCount: 6, sha256: "hash" };
    const index = sourceReferenceIndex(replay);
    expect(index.coverage(0)).toEqual({
      shown: 0,
      total: 15,
      explained: 0,
      included: 0,
    });
    expect(index.coverage(1)).toEqual({
      shown: 1,
      total: 15,
      explained: 1,
      included: 0,
    });
    expect(index.coverage(2)).toEqual({
      shown: 0,
      total: 15,
      explained: 0,
      included: 0,
    });
  });
  it("keeps bulk-imported source separate without losing earlier explained lines or exact navigation", () => {
    const replay = course([
      step({
        kind: "write",
        path: "a.go",
        content: "one\ntwo\n",
        sourceLines: [[1, 2]],
      }),
      step({
        kind: "write",
        path: "a.go",
        content: "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n",
        sourceLines: [[1, 9]],
        sourceMode: "included",
      }),
    ]);
    const index = sourceReferenceIndex(replay);
    expect(index.coverage(1)).toEqual({
      shown: 2,
      total: 9,
      explained: 2,
      included: 0,
    });
    expect(index.coverage(2)).toEqual({
      shown: 9,
      total: 9,
      explained: 2,
      included: 7,
    });
    expect(index.resolve("source:a.go#L8-L9", 1)).toMatchObject({
      destination: { cursor: 2, displayed: [8, 9], preview: "eight\nnine\n" },
    });
  });
  it("rejects corrupt counts, overlaps and excessive coordinates", () => {
    for (const ranges of [
      [
        [1, 2],
        [2, 3],
      ],
      [[0, 2]],
      [[1, 10]],
      [[1, Number.MAX_VALUE]],
      "bad",
      null,
    ])
      expect(validSourceRanges(ranges, 9, 3)).toBe(false);
    expect(
      validSourceRanges(
        [
          [1, 2],
          [8, 9],
        ],
        9,
        4,
      ),
    ).toBe(true);
  });
});
