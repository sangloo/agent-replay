// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { play } from "@agent-replay/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addExplain,
  addLesson,
  amend,
  describe as describeStep,
  courseTarget,
  example,
  fill,
  globOf,
  loadCourse,
  mapLines,
  progressOf,
  startCourse,
  take,
  undo,
  write,
} from "./course.ts";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "replay-course-")));
const repo = join(temp, "repo");

const VEC = [
  "export interface Vec {",
  "  x: number;",
  "  y: number;",
  "}",
  "",
  "export function add(a: Vec, b: Vec): Vec {",
  "  return { x: a.x + b.x, y: a.y + b.y };",
  "}",
  "",
  "export function dot(a: Vec, b: Vec): number {",
  "  return a.x * b.x + a.y * b.y;",
  "}",
  "",
].join("\n");

beforeAll(() => {
  mkdirSync(join(repo, "src"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "# vec\n");
  writeFileSync(join(repo, "src/vec.ts"), VEC);
  writeFileSync(join(repo, "src/index.ts"), 'export * from "./vec";\n');
  writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-qm",
    "vec",
  ]);
});

afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("a course", () => {
  it("builds the target in build order, a piece at a time, and knows when it is done", () => {
    let course = startCourse(repo, { title: "Learn vec" });
    const target = courseTarget(course);
    expect([...target.files.keys()]).toEqual([
      "README.md",
      "src/vec.ts",
      "src/index.ts",
    ]);
    expect(target.skipped).toEqual(["pnpm-lock.yaml"]);

    course = addLesson(course, "Vectors", "Know what a Vec is.");
    course = take(course, target, "src/vec.ts", [
      [1, 4],
      [10, 12],
    ]);
    // Lines as the target counts them, lit where they now are.
    course = addExplain(course, target, "The dot product.", {
      path: "src/vec.ts",
      lines: [10, 12],
    });
    expect(course.replay.steps.at(-1)).toMatchObject({
      kind: "explain",
      lines: [5, 7],
    });
    expect(() =>
      addExplain(course, target, "Addition.", { path: "src/vec.ts", lines: [6, 8] }),
    ).toThrow(/not in the file yet/);

    course = take(course, target, "src/vec.ts");
    expect(() => take(course, target, "src/vec.ts")).toThrow(/nothing to add/);
    course = example(course, target, "learn/try.ts", "dot({x:1,y:0},{x:0,y:1});\n");
    expect(() => example(course, target, "src/vec.ts", "x")).toThrow(/examples need/);
    expect(() => write(course, target, "learn/other.ts", "x")).toThrow(
      /not in the target/,
    );

    let progress = progressOf(course, target);
    expect(progress).toMatchObject({ complete: 1, missing: 2, extra: [], lessons: 1 });

    const filled = fill(course, target, []);
    course = filled.course;
    expect(filled.filled).toEqual(["README.md", "src/index.ts"]);
    progress = progressOf(course, target);
    expect(progress).toMatchObject({ complete: 3, partial: 0, missing: 0 });
    expect(progress.lines).toBe(progress.totalLines);

    // The course plays: the example is marked, and nothing is left over.
    const playback = play(course.replay);
    expect(
      playback.filesAt(playback.length).find((f) => f.path === "learn/try.ts"),
    ).toMatchObject({
      aside: true,
    });
    expect(playback.coverageAt(playback.length)).toMatchObject({
      files: 3,
      totalFiles: 3,
    });

    // Reloaded from disk as the newest course; undo takes back the last step.
    const again = loadCourse(repo);
    expect(again.replay.steps).toHaveLength(course.replay.steps.length);
    const { removed } = undo(again, 2);
    expect(removed.map((step) => step.kind)).toEqual(["write", "write"]);
  });
});

describe("correcting a course", () => {
  it("refuses to shrink a file silently, bounds line ranges, and amends in place", () => {
    let course = startCourse(repo, { title: "Fixes" });
    const target = courseTarget(course);
    course = take(course, target, "src/vec.ts", [[1, 8]]);
    expect(() => take(course, target, "src/vec.ts", [[1, 4]])).toThrow(
      /remove 4 lines the learner has already seen \(5–8\)/,
    );
    expect(() => take(course, target, "src/vec.ts", [[1, 99]])).toThrow(/past its end/);
    course = take(course, target, "src/vec.ts", [[1, 4]], undefined, { drop: true });
    course = addLesson(course, "One");
    course = addExplain(course, target, "Frist draft.");
    course = amend(course, 4, { text: "First draft." });
    course = amend(course, 3, { goal: "Know it." });
    expect(course.replay.steps[2]).toMatchObject({ title: "One", goal: "Know it." });
    expect(describeStep(course.replay.steps[3]!, 3)).toBe(
      '   #4  explain  "First draft."',
    );
    expect(() => amend(course, 3, { text: "x" })).toThrow(/not an explanation/);
    expect(() => amend(course, 9, { text: "x" })).toThrow(/no step #9/);
  });
});

describe("globOf", () => {
  it("matches folders, names at any depth, and globs across folders", () => {
    expect(globOf("src")("src/a/b.ts")).toBe(true);
    expect(globOf("src/")("srcx/a.ts")).toBe(false);
    expect(globOf("*.json")("config/app.json")).toBe(true);
    expect(globOf("src/*.ts")("src/a/b.ts")).toBe(false);
    expect(globOf("src/**/*.ts")("src/a/b.ts")).toBe(true);
    expect(globOf(".github/**")(".github/workflows/ci.yml")).toBe(true);
  });
});

describe("mapLines", () => {
  it("finds a block by its lines before trusting a diff with a lone brace", () => {
    const target = "a {\n}\nb {\n}\n";
    expect(mapLines("b {\n}\n", target, [3, 4])).toEqual([1, 2]);
    expect(() => mapLines("a {\n}\n", target, [3, 3])).toThrow(/take them first/);
  });
});
