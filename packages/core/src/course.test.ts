import { describe, expect, it } from "vitest";

import { courseProgress, outline, parseRanges, sliceLines } from "./course.ts";
import { REPLAY_VERSION, type Replay, type Step } from "./format.ts";
import { buildOrder } from "./order.ts";

const at = "2026-01-01T00:00:00.000Z";
const base = { at, agent: "main", turn: 0 };

const course = (steps: Step[]): Replay => ({
  version: REPLAY_VERSION,
  id: "course:t",
  title: "t",
  source: "course",
  startedAt: at,
  endedAt: at,
  repo: { name: "r", commits: [] },
  files: {},
  omitted: [],
  steps,
  notes: {},
  course: { rev: "abc" },
});

describe("line ranges", () => {
  it("parses ranges and single lines", () => {
    expect(parseRanges("1-3, 7")).toEqual([
      [1, 3],
      [7, 7],
    ]);
    expect(() => parseRanges("3-1")).toThrow(/line range/);
    expect(() => parseRanges("x")).toThrow(/line range/);
  });

  it("slices in file order, once, and ends the last line", () => {
    const file = "a\nb\nc\nd";
    expect(
      sliceLines(file, [
        [3, 4],
        [1, 1],
        [1, 2],
      ]),
    ).toBe("a\nb\nc\nd\n");
    expect(sliceLines(file, [[2, 2]])).toBe("b\n");
    expect(() => sliceLines(file, [[9, 9]])).toThrow(/past the end/);
  });
});

describe("outline", () => {
  it("finds definitions across languages", () => {
    const ts =
      "import x from 'y';\nexport function add(a, b) {}\nexport const mul = (a, b) => a * b;\nclass Box {}\ninterface P {}\n";
    expect(outline(ts).map((s) => `${s.kind} ${s.name} ${s.line}`)).toEqual([
      "function add 2",
      "const mul 3",
      "class Box 4",
      "interface P 5",
    ]);
    expect(outline("def area(r):\n  pass\n").map((s) => s.name)).toEqual(["area"]);
    expect(outline("func (p *Point) Norm() float64 {\n}\n").map((s) => s.name)).toEqual(
      ["Norm"],
    );
  });
});

describe("courseProgress", () => {
  it("measures files and lines against the target, asides aside", () => {
    const target = new Map([
      ["src/a.ts", "one\ntwo\nthree\n"],
      ["src/b.ts", "b\n"],
    ]);
    const progress = courseProgress(
      course([
        { kind: "lesson", id: "l1", ...base, title: "Start" },
        { kind: "write", id: "w1", ...base, path: "src/a.ts", content: "one\nthree\n" },
        {
          kind: "write",
          id: "w2",
          ...base,
          path: "learn/try.ts",
          content: "x\n",
          aside: true,
        },
        { kind: "write", id: "w3", ...base, path: "src/stray.ts", content: "s\n" },
      ]),
      target,
    );
    expect(progress).toMatchObject({
      complete: 0,
      partial: 1,
      missing: 1,
      lines: 2,
      totalLines: 4,
      extra: ["src/stray.ts"],
      lessons: 1,
    });
  });
});

describe("buildOrder", () => {
  it("puts what a file imports before it, and tests after", () => {
    const order = buildOrder([
      { path: "README.md", content: "" },
      { path: "src/index.ts", content: 'import { a } from "./a";' },
      { path: "src/a.ts", content: 'import { b } from "./b";' },
      { path: "src/b.ts", content: "" },
      { path: "src/a.test.ts", content: 'import { a } from "./a";' },
    ]);
    expect(order).toEqual([
      "README.md",
      "src/b.ts",
      "src/a.ts",
      "src/index.ts",
      "src/a.test.ts",
    ]);
  });
});
