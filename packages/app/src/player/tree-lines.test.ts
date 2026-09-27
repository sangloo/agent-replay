import { describe, expect, it } from "vitest";

import { ancestorIds, treeLines } from "./tree-lines";

describe("treeLines", () => {
  it("puts folders first, sorts naturally, and folds single-folder chains", () => {
    const lines = treeLines([
      "README.md",
      "apps/replay/src/app.tsx",
      "apps/replay/src/player/file10.ts",
      "apps/replay/src/player/file2.ts",
      "apps/replay/package.json",
      "packages/core/index.ts",
    ]);
    expect(lines.map((line) => [line.label, line.parentId])).toEqual([
      ["apps/replay", null],
      ["src", "d:apps/replay"],
      ["player", "d:apps/replay/src"],
      ["file2.ts", "d:apps/replay/src/player"],
      ["file10.ts", "d:apps/replay/src/player"],
      ["app.tsx", "d:apps/replay/src"],
      ["package.json", "d:apps/replay"],
      ["packages/core", null],
      ["index.ts", "d:packages/core"],
      ["README.md", null],
    ]);
    expect(lines.filter((line) => line.container).map((line) => line.id)).toEqual(
      lines.filter((line) => line.id.startsWith("d:")).map((line) => line.id),
    );
  });

  it("names every folder above a file, folded or not, so any of them can open", () => {
    expect(ancestorIds("apps/replay/src/app.tsx")).toEqual([
      "d:apps",
      "d:apps/replay",
      "d:apps/replay/src",
    ]);
    expect(ancestorIds("README.md")).toEqual([]);
  });
});
