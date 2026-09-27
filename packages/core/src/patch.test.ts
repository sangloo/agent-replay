import { describe, expect, it } from "vitest";

import { capture, editBetween } from "./capture.ts";
import { play } from "./play.ts";
import { applyChunks, extractPatch, parsePatch } from "./patch.ts";
import type { Transcript } from "./transcript.ts";

const PATCH = `*** Begin Patch
*** Add File: src/new.ts
+export const a = 1;
+export const b = 2;
*** Update File: src/old.ts
@@ function outer() {
   const x = 1;
-  return x;
+  return x + 1;
 }
*** Delete File: src/gone.ts
*** Update File: src/move.ts
*** Move to: src/moved.ts
@@
-old
+new
*** End Patch`;

describe("parsePatch", () => {
  it("reads every kind of file section", () => {
    const files = parsePatch(PATCH);
    expect(files.map((f) => [f.op, f.path])).toEqual([
      ["add", "src/new.ts"],
      ["update", "src/old.ts"],
      ["delete", "src/gone.ts"],
      ["update", "src/move.ts"],
    ]);
    expect(files[0]).toMatchObject({
      content: "export const a = 1;\nexport const b = 2;\n",
    });
    expect(files[1]).toMatchObject({
      chunks: [
        {
          context: "function outer() {",
          oldLines: ["  const x = 1;", "  return x;", "}"],
          newLines: ["  const x = 1;", "  return x + 1;", "}"],
        },
      ],
    });
    expect(files[3]).toMatchObject({ moveTo: "src/moved.ts" });
  });

  it("finds a patch wrapped in a heredoc", () => {
    const wrapped = `apply_patch <<'EOF'\n${PATCH}\nEOF`;
    expect(extractPatch(wrapped)).toBe(PATCH);
    expect(parsePatch("no patch here")).toEqual([]);
  });
});

describe("applyChunks", () => {
  const file = "function outer() {\n  const x = 1;\n  return x;\n}\n";

  it("applies a chunk after its @@ context", () => {
    const [, update] = parsePatch(PATCH);
    expect(update?.op === "update" && applyChunks(file, update.chunks)).toBe(
      "function outer() {\n  const x = 1;\n  return x + 1;\n}\n",
    );
  });

  it("tolerates trailing whitespace the patch dropped", () => {
    const chunks = [
      { oldLines: ["  return x;"], newLines: ["  return 2;"], eof: false },
    ];
    expect(applyChunks(file.replace("return x;", "return x;  "), chunks)).toContain(
      "return 2;",
    );
  });

  it("refuses a chunk whose context is not there", () => {
    const chunks = [{ oldLines: ["nope"], newLines: ["x"], eof: false }];
    expect(applyChunks(file, chunks)).toBeUndefined();
  });

  it("keeps two pure additions in the order they were written", () => {
    const chunks = [
      { oldLines: [], newLines: ["X"], eof: false },
      { oldLines: [], newLines: ["Y"], eof: false },
    ];
    expect(applyChunks("a\n", chunks)).toBe("a\nX\nY\n");
  });

  it("appends a chunk with no old lines", () => {
    const chunks = [{ oldLines: [], newLines: ["// end"], eof: true }];
    expect(applyChunks("a\n", chunks)).toBe("a\n// end\n");
  });
});

describe("editBetween", () => {
  it("is the changed lines, when they are unique", () => {
    expect(editBetween("a\nb\nc\n", "a\nB\nc\n")).toEqual({
      oldString: "b\n",
      newString: "B\n",
    });
  });

  it("gives up on an ambiguous region, so the change is stored whole", () => {
    expect(editBetween("x\nx\n", "x\ny\n")).toBeUndefined();
  });
});

describe("capture with patches", () => {
  const ROOT = "/repo";
  const transcript: Transcript = {
    source: "codex",
    sessionId: "s",
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T00:00:05Z",
    events: [
      { type: "prompt", at: "2026-01-01T00:00:01Z", agent: "main", text: "go" },
      { type: "text", at: "2026-01-01T00:00:02Z", agent: "main", text: "Patching." },
      {
        type: "action",
        at: "2026-01-01T00:00:03Z",
        agent: "main",
        id: "call_1",
        failed: false,
        actions: [
          {
            kind: "patch",
            files: parsePatch(PATCH).map((f) => ({
              ...f,
              path: `${ROOT}/${f.path}`,
              ...(f.op === "update" && f.moveTo
                ? { moveTo: `${ROOT}/${f.moveTo}` }
                : {}),
            })),
          },
        ],
      },
    ],
  };
  const base: Record<string, string | null> = {
    "src/old.ts": "function outer() {\n  const x = 1;\n  return x;\n}\n",
    "src/gone.ts": "bye\n",
    "src/move.ts": "old\n",
  };

  it("turns each file of a patch into its own step, in order", () => {
    const replay = capture([transcript], {
      root: ROOT,
      repo: { name: "repo", commits: [] },
      readBase: (path) => base[path] ?? null,
    });
    expect(replay.source).toBe("codex");
    expect(replay.steps.map((s) => [s.kind, s.id, "path" in s ? s.path : ""])).toEqual([
      ["prompt", "prompt:0", ""],
      ["write", "call_1.0", "src/new.ts"],
      ["edit", "call_1.1", "src/old.ts"],
      ["delete", "call_1.2", "src/gone.ts"],
      ["delete", "call_1.3", "src/move.ts"],
      ["write", "call_1.4", "src/moved.ts"],
    ]);
    expect(replay.steps[1]).toMatchObject({ why: "Patching." });
    const playback = play(replay);
    const end = playback.length;
    expect(playback.contentAt("src/old.ts", end)).toContain("return x + 1;");
    expect(playback.contentAt("src/gone.ts", end)).toBeNull();
    expect(playback.contentAt("src/moved.ts", end)).toBe("new\n");
    expect(playback.frames.every((f) => f.change?.applied !== false)).toBe(true);
  });
});
