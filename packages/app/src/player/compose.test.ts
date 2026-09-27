import { diffHunks } from "@agent-replay/core";
import { describe, expect, it } from "vitest";

import {
  composeDiff,
  PACE,
  timelineOf,
  plainLines,
  type Diffable,
  type Line,
} from "./compose";

const diff = (before: string | null, after: string | null): Diffable => ({
  before,
  after,
  hunks: diffHunks(before ?? "", after ?? ""),
});

/** `-b` / `+Xb` / ` a`, strong runs in brackets, `|` for the caret. */
const show = (lines: readonly Line[]) =>
  lines.map(
    (line) =>
      ({ context: " ", removed: "-", added: "+" })[line.kind] +
      line.spans
        .map(
          (s, i) =>
            (line.caret === i ? "|" : "") +
            (s.kind === "strong" ? `[${s.text}]` : s.text),
        )
        .join("") +
      (line.caret === line.spans.length ? "|" : ""),
  );

const textOf = (line: Line) => line.spans.map((s) => s.text).join("");

describe("composeDiff", () => {
  it("keeps both sides once a change has played, the changed characters marked", () => {
    const lines = composeDiff(
      diff(
        "const answer = 41;\nconst other = 1;\n",
        "const answer = 42;\nconst other = 1;\n",
      ),
    );
    expect(show(lines)).toEqual([
      "-const answer = 4[1];",
      "+const answer = 4[2];",
      " const other = 1;",
    ]);
    expect(lines.map((line) => line.number)).toEqual([null, 1, 2]);
    expect(lines.map((line) => line.hot)).toEqual([true, true, false]);
  });

  it("marks what goes, then types what comes beneath it", () => {
    const change = diff("a\nold line\nz\n", "a\nnew line\nz\n");
    const timeline = timelineOf(change);
    const at = (seconds: number) => show(composeDiff(change, seconds / timeline.total));
    // Marking: the old line is there, nothing typed yet.
    expect(at(PACE.mark / 2)).toEqual([" a", "-[old] line", " z"]);
    // Typing: part of the new line, with the caret at the typing point.
    const { type } = timeline.hunks[0]!;
    expect(at((type.start + type.end) / 2)[2]).toMatch(/^\+\[n(e)?\]\| line$/);
    // Holding, and settled: both sides, for good.
    const landed = [" a", "-[old] line", "+[new] line", " z"];
    expect(at(timeline.hold.start + 0.01)).toEqual(landed);
    expect(show(composeDiff(change, 1))).toEqual(landed);
  });

  it("types one hunk after another, travelling between them", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g"].join("\n") + "\n";
    const after = before.replace("b", "B").replace("f", "F");
    const change = diff(before, after);
    const timeline = timelineOf(change);
    expect(timeline.hunks).toHaveLength(2);
    const [first, second] = timeline.hunks;
    expect(second!.travel.start).toBeCloseTo(first!.type.end);
    expect(second!.travel.end - second!.travel.start).toBeCloseTo(PACE.travel);
    // Travelling to the second hunk: the first is done, the second waits
    // with the caret where it will type.
    const lines = composeDiff(change, (second!.travel.start + 0.01) / timeline.total);
    expect(show(lines)).toContain("+[B]");
    expect(show(lines).some((line) => line.startsWith("+") && line.includes("|"))).toBe(
      true,
    );
  });

  it("paces typing by length, within bounds", () => {
    const small = timelineOf(diff("x\n", "y\n"));
    const large = timelineOf(diff(null, "z".repeat(200_000)));
    const typing = (t: ReturnType<typeof timelineOf>) =>
      t.hunks.reduce((sum, h) => sum + h.type.end - h.type.start, 0);
    expect(typing(small)).toBeCloseTo(PACE.minType);
    expect(typing(large)).toBeLessThanOrEqual(PACE.maxTyping);
    expect(large.mark.end).toBe(0);
  });

  it("types a new file from nothing, with no lines to mark", () => {
    const created = diff(null, "one\ntwo\n");
    const timeline = timelineOf(created);
    const { type } = timeline.hunks[0]!;
    const lines = composeDiff(created, (type.start + type.end) / 2 / timeline.total);
    expect(lines.every((line) => line.kind === "added")).toBe(true);
    expect(lines.some((line) => line.caret !== undefined)).toBe(true);
    expect(show(composeDiff(diff(null, "one\ntwo\n")))).toEqual(["+one", "+two"]);
  });

  it("shows a deleted file as all removed", () => {
    expect(show(composeDiff(diff("one\ntwo\n", null)))).toEqual(["-one", "-two"]);
  });

  it("inserts whole lines without touching their neighbours", () => {
    expect(show(composeDiff(diff("a\nc\n", "a\nb\nc\n")))).toEqual([" a", "+b", " c"]);
    expect(show(composeDiff(diff("a\nb\nc\n", "a\nc\n")))).toEqual([" a", "-b", " c"]);
  });

  it("never lets the line after a block run into it", () => {
    expect(show(composeDiff(diff("a\nb", "a\nXb")))).toEqual([" a", "-b", "+[X]b"]);
    expect(show(composeDiff(diff("ab\ncd\n", "abcd\n")))).toEqual([
      "-ab",
      "-cd",
      "+abcd",
    ]);
  });

  it("numbers the new side and keeps offsets into each source for colour", () => {
    const lines = composeDiff(diff("a\nb\nc\n", "a\nB1\nB2\nc\n"));
    expect(lines.map((line) => line.number)).toEqual([1, null, 2, 3, 4]);
    const added = lines.filter((line) => line.kind === "added");
    expect(added.map((line) => [textOf(line), line.spans[0]!.at])).toEqual([
      ["B1", 2],
      ["B2", 5],
    ]);
    expect(lines.at(-1)!.spans[0]).toMatchObject({
      text: "c",
      source: "before",
      at: 4,
    });
  });

  it("rebuilds both sides exactly, for any edit", () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const words = ["a", "b", "c", "", "dd", "e e"];
    const text = () =>
      Array.from(
        { length: Math.floor(random() * 8) },
        () => words[Math.floor(random() * words.length)],
      ).join("\n") + (random() < 0.5 ? "\n" : "");
    for (let round = 0; round < 400; round++) {
      const before = text();
      const after = random() < 0.2 ? before : text();
      const lines = composeDiff(diff(before, after));
      const side = (kind: Line["kind"]) =>
        lines.filter((line) => line.kind !== kind).map(textOf);
      const split = (value: string) =>
        value === "" ? [] : value.replace(/\n$/, "").split("\n");
      expect(side("added"), JSON.stringify({ before, after })).toEqual(split(before));
      expect(side("removed"), JSON.stringify({ before, after })).toEqual(split(after));
    }
  });
});

describe("plainLines", () => {
  it("numbers every line and marks none", () => {
    const lines = plainLines("one\n\nthree\n");
    expect(lines.map((line) => [line.number, textOf(line), line.hot])).toEqual([
      [1, "one", false],
      [2, "", false],
      [3, "three", false],
    ]);
  });
});
