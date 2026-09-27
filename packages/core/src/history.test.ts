import { describe, expect, it } from "vitest";

import { buildHistory, type HistoryCommit } from "./history.ts";
import { importsOf, readingOrder } from "./order.ts";
import { play } from "./play.ts";

const repo = { name: "repo", commits: [] };

describe("readingOrder", () => {
  it("goes README, manifests, entry point, then down the imports, tests last", () => {
    const files = [
      {
        path: "src/util/strings.ts",
        content: "export const up = (s: string) => s.toUpperCase();",
      },
      {
        path: "src/index.ts",
        content: 'import { greet } from "./greet";\nconsole.log(greet());',
      },
      {
        path: "src/greet.ts",
        content:
          'import { up } from "./util/strings";\nexport const greet = () => up("hi");',
      },
      { path: "src/greet.test.ts", content: 'import { greet } from "./greet";' },
      { path: "package.json", content: "{}" },
      { path: "README.md", content: "# repo" },
      { path: "docs/notes.txt", content: "" },
    ];
    expect(readingOrder(files)).toEqual([
      "README.md",
      "package.json",
      "src/index.ts",
      "src/greet.ts",
      "src/util/strings.ts",
      "docs/notes.txt",
      "src/greet.test.ts",
    ]);
  });

  it("leads with a package's own README when only that package is shown", () => {
    const order = readingOrder([
      { path: "packages/geo/src/index.ts", content: "" },
      { path: "packages/geo/README.md", content: "# geo" },
      { path: "packages/geo/package.json", content: "{}" },
    ]);
    expect(order.slice(0, 2)).toEqual([
      "packages/geo/README.md",
      "packages/geo/package.json",
    ]);
  });

  it("follows Go imports through the module path", () => {
    const paths = new Set([
      "cmd/api/main.go",
      "internal/store/store.go",
      "internal/store/store_test.go",
    ]);
    const main = {
      path: "cmd/api/main.go",
      content: 'package main\nimport (\n  "fmt"\n  "example.com/app/internal/store"\n)',
    };
    expect(importsOf(main, paths, "example.com/app")).toEqual([
      "internal/store/store.go",
    ]);
  });
});

describe("buildHistory", () => {
  const commits: HistoryCommit[] = [
    {
      sha: "aaa",
      subject: "Initial commit",
      author: "Ada",
      at: "2026-01-01T00:00:00Z",
      introduces: true,
      changes: [
        { path: "src/b.ts", after: "export const b = 1;\n" },
        { path: "README.md", after: "# repo\n" },
        { path: "src/index.ts", after: 'import { b } from "./b";\n' },
      ],
    },
    {
      sha: "bbb",
      subject: "Bump b",
      body: "Because two is better.",
      at: "2026-01-02T00:00:00Z",
      changes: [
        { path: "src/b.ts", after: "export const b = 2;\n" },
        { path: "README.md", after: null },
        { path: "pnpm-lock.yaml", after: "lock: 2\n" },
      ],
    },
  ];
  const replay = buildHistory(commits, {
    repo,
    base: { "pnpm-lock.yaml": "lock: 1\n" },
    title: "History",
  });

  it("introduces the first commit's files in reading order, after the commit", () => {
    expect(replay.source).toBe("git");
    expect(
      replay.steps.slice(0, 4).map((s) => ("path" in s ? s.path : s.kind)),
    ).toEqual(["commit", "README.md", "src/index.ts", "src/b.ts"]);
  });

  it("stores later changes as edits, deletions and omitted lockfiles", () => {
    const later = replay.steps.slice(4);
    expect(later.map((s) => [s.kind, s.id])).toEqual([
      ["commit", "commit:bbb"],
      ["external", "bbb:pnpm-lock.yaml"],
      ["delete", "bbb:README.md"],
      ["edit", "bbb:src/b.ts"],
    ]);
    expect(later[0]).toMatchObject({
      subject: "Bump b",
      body: "Because two is better.",
    });
    expect(replay.omitted).toEqual(["pnpm-lock.yaml"]);
  });

  it("plays to the end state and measures how much of it exists", () => {
    const playback = play(replay);
    expect(playback.contentAt("src/b.ts", playback.length)).toBe(
      "export const b = 2;\n",
    );
    expect(playback.contentAt("README.md", playback.length)).toBeNull();
    expect(playback.coverageAt(0)).toMatchObject({ files: 1, totalFiles: 3 });
    const afterFirst = playback.coverageAt(4);
    expect(afterFirst).toMatchObject({ files: 3, totalFiles: 3 });
    expect(afterFirst.lines).toBeLessThan(afterFirst.totalLines);
    expect(playback.coverageAt(playback.length)).toMatchObject({
      lines: afterFirst.totalLines,
    });
  });

  it("omits a file from the start when it grows too large later", () => {
    const grows = buildHistory(
      [
        {
          sha: "c1",
          subject: "small",
          at: "2026-01-01T00:00:00Z",
          changes: [{ path: "data.txt", after: "x\n" }],
        },
        {
          sha: "c2",
          subject: "edit",
          at: "2026-01-02T00:00:00Z",
          changes: [{ path: "data.txt", after: "y\n" }],
        },
        {
          sha: "c3",
          subject: "huge",
          at: "2026-01-03T00:00:00Z",
          changes: [{ path: "data.txt", after: "z".repeat(100) }],
        },
      ],
      { repo, base: {}, title: "t", maxFileBytes: 50 },
    );
    expect(grows.omitted).toEqual(["data.txt"]);
    const playback = play(grows);
    expect(playback.frames.every((f) => f.change?.applied !== false)).toBe(true);
  });
});
