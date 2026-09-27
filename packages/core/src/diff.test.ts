import { describe, expect, it } from "vitest";

import { applyHunks, countLines, diffHunks, splitLines } from "./diff.ts";

describe("diffHunks", () => {
  it("is empty for equal texts", () => {
    expect(diffHunks("a\nb\n", "a\nb\n")).toEqual([]);
  });

  it("tightens a changed line to the characters that differ", () => {
    const before = "const a = 1;\nexport const answer = 41;\n";
    const after = "const a = 1;\nexport const answer = 42;\n";
    expect(diffHunks(before, after)).toEqual([
      { at: before.indexOf("41") + 1, remove: "1", insert: "2" },
    ]);
  });

  it("keeps separated changes in separate hunks", () => {
    const before = "one\ntwo\nthree\nfour\nfive\n";
    const after = "ONE\ntwo\nthree\nfour\nFIVE\nsix\n";
    const hunks = diffHunks(before, after);
    expect(hunks).toHaveLength(2);
    expect(applyHunks(before, hunks)).toBe(after);
  });

  it("handles creation, deletion and a missing final newline", () => {
    expect(applyHunks("", diffHunks("", "x\ny"))).toBe("x\ny");
    expect(applyHunks("x\ny", diffHunks("x\ny", ""))).toBe("");
    expect(applyHunks("x\ny", diffHunks("x\ny", "x\ny\n"))).toBe("x\ny\n");
  });

  it("diffs a large new file against nothing without searching", () => {
    const big = Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join("\n");
    const started = performance.now();
    expect(countLines(diffHunks("", big), "")).toEqual({ added: 20_000, removed: 0 });
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("round-trips random edits", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const words = ["alpha", "beta", "gamma", "", "  delta();", "}"];
    const text = () =>
      Array.from(
        { length: Math.floor(random() * 30) },
        () => words[Math.floor(random() * words.length)],
      ).join("\n");
    for (let i = 0; i < 300; i++) {
      const before = text();
      const after = text();
      const hunks = diffHunks(before, after);
      expect(applyHunks(before, hunks)).toBe(after);
      for (let j = 1; j < hunks.length; j++) {
        const previous = hunks[j - 1]!;
        expect(hunks[j]!.at).toBeGreaterThanOrEqual(
          previous.at + previous.remove.length,
        );
      }
    }
  });
});

describe("lines", () => {
  it("splits with terminators", () => {
    expect(splitLines("a\nb")).toEqual(["a\n", "b"]);
    expect(splitLines("")).toEqual([]);
  });

  it("counts added and removed lines", () => {
    expect(countLines([{ at: 0, remove: "a\nb\n", insert: "c\n" }], "a\nb\n")).toEqual({
      added: 1,
      removed: 2,
    });
  });

  it("counts lines as git does, not the characters a hunk was tightened to", () => {
    const count = (before: string, after: string) =>
      countLines(diffHunks(before, after), before);
    // A line that only gained a comma is one line out, one in.
    expect(count('{\n  "a": 1\n}\n', '{\n  "a": 1,\n  "b": 2\n}\n')).toEqual({
      added: 2,
      removed: 1,
    });
    expect(count("a\nc\n", "a\nb\nc\n")).toEqual({ added: 1, removed: 0 });
    expect(count("a\nb\nc\n", "a\nc\n")).toEqual({ added: 0, removed: 1 });
    expect(count("a", "a\nb")).toEqual({ added: 2, removed: 1 });
    expect(count("x = 1\n", "x = 2\n")).toEqual({ added: 1, removed: 1 });
  });
});
