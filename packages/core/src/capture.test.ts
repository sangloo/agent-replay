import { beforeEach, describe, expect, it } from "vitest";

import { capture, editBetween, type CaptureOptions } from "./capture.ts";
import type { ExternalStep, Replay } from "./format.ts";
import { annotate, readNotes } from "./notes.ts";
import { play } from "./play.ts";
import { parseTranscript } from "./agents/index.ts";
import {
  ROOT,
  bash,
  call,
  edit,
  prompt,
  resetClock,
  result,
  say,
  write,
} from "./transcript-fixture.ts";

const repo = { name: "repo", commits: [] };

function run(lines: string[], options: Partial<CaptureOptions> = {}): Replay {
  return capture([parseTranscript(lines.join("\n"))], {
    root: ROOT,
    repo,
    ...options,
  });
}

const GREET = 'export const greet = (name: string) => "hi " + name;\n';

beforeEach(resetClock);

describe("editBetween", () => {
  it("reconstructs a complete file from an excerpt beginning with a newline", () => {
    const before = "\nbody\n";
    const after = "header\n\nbody\nend\n";
    const change = editBetween(before, after);
    expect(change).toBeDefined();
    expect(before.replace(change!.oldString, change!.newString)).toBe(after);
  });
});

describe("capture", () => {
  it("turns prompts, changes and commands into steps with their narration", () => {
    const replay = run([
      prompt("Add a greeting"),
      say("I'll create the module."),
      ...write("w1", "src/greet.ts", GREET, null),
      say("Now the punctuation."),
      ...edit("e1", "src/greet.ts", GREET, '"hi "', '"hi, "'),
      ...bash("b1", "pnpm test", "1 passed"),
      say("Done — greeting added."),
    ]);

    expect(replay.id).toBe("session-1");
    expect(replay.title).toBe("Add a greeting");
    expect(replay.files).toEqual({ "src/greet.ts": null });
    expect(replay.steps.map((s) => s.kind)).toEqual([
      "prompt",
      "write",
      "edit",
      "command",
      "say",
    ]);
    expect(replay.steps[1]).toMatchObject({
      id: "w1",
      path: "src/greet.ts",
      why: "I'll create the module.",
      turn: 0,
    });
    expect(replay.steps[2]).toMatchObject({ why: "Now the punctuation." });
    expect(replay.steps[3]).toMatchObject({
      command: "pnpm test",
      output: "1 passed",
    });
    expect(replay.steps[4]).toMatchObject({ text: "Done — greeting added." });
  });

  it("uses the base commit's content for a file's starting state", () => {
    const replay = run([prompt("bump"), ...edit("e1", "a.ts", "x = 1\n", "1", "2")], {
      readBase: (path) => (path === "a.ts" ? "x = 1\n" : null),
    });
    expect(replay.files).toEqual({ "a.ts": "x = 1\n" });
    expect(replay.steps.map((s) => s.kind)).toEqual(["prompt", "edit"]);
  });

  it("inserts a drift step when a tool saw something the replay did not produce", () => {
    const formatted = GREET.replace("(name: string)", "(name: string): string");
    const replay = run([
      prompt("go"),
      ...write("w1", "src/greet.ts", GREET, null),
      ...bash("b1", "pnpm prettier --write src/greet.ts"),
      ...edit("e1", "src/greet.ts", formatted, '"hi "', '"hey "'),
    ]);
    const drift = replay.steps[3] as ExternalStep;
    expect(drift).toMatchObject({
      kind: "external",
      reason: "drift",
      path: "src/greet.ts",
      content: formatted,
      cause: "b1",
    });
    const playback = play(replay);
    expect(playback.contentAt("src/greet.ts", playback.length)).toBe(
      formatted.replace('"hi "', '"hey "'),
    );
    expect(playback.frames.every((f) => f.change?.applied !== false)).toBe(true);
  });

  it("reconciles with the end state: a file deleted by a command", () => {
    const replay = run(
      [
        prompt("remove the old module"),
        ...bash("b1", "git rm src/old.ts"),
        ...bash("b2", "pnpm test"),
      ],
      {
        readBase: (path) => (path === "src/old.ts" ? "old\n" : null),
        readFinal: () => null,
        changed: ["src/old.ts"],
      },
    );
    expect(replay.files).toEqual({ "src/old.ts": "old\n" });
    expect(replay.steps.map((s) => s.id)).toEqual([
      "prompt:u-0",
      "b1",
      "untracked:src/old.ts",
      "b2",
    ]);
    expect(replay.steps[2]).toMatchObject({ content: null, cause: "b1" });
  });

  it("appends unexplained end-state changes after the file's last recorded change", () => {
    const replay = run([prompt("go"), ...write("w1", "a.ts", "one\n", null)], {
      readBase: () => null,
      readFinal: () => "one\ntwo\n",
      changed: [],
    });
    expect(replay.steps.at(-1)).toMatchObject({
      kind: "external",
      reason: "untracked",
      path: "a.ts",
      content: "one\ntwo\n",
    });
    expect(replay.steps.at(-1)).not.toHaveProperty("cause");
  });

  it("places an unexplained change when the file was last written", () => {
    const written = "2026-01-01T00:00:03.500Z";
    const replay = run([prompt("first"), say("reading"), prompt("second"), say("ok")], {
      readBase: () => null,
      readFinal: (path) => (path === "notes.md" ? "made elsewhere\n" : null),
      changed: ["notes.md"],
      modifiedAt: () => written,
    });
    expect(replay.steps.map((s) => s.kind)).toEqual([
      "prompt",
      "say",
      "prompt",
      "external",
      "say",
    ]);
    expect(replay.steps[3]).toMatchObject({ path: "notes.md", at: written });
  });

  it("keeps a timed change after the file's last recorded edit", () => {
    const replay = run(
      [prompt("go"), ...write("w1", "a.ts", "one\n", null), prompt("next"), say("ok")],
      {
        readBase: () => null,
        readFinal: (path) => (path === "a.ts" ? "one\ntwo\n" : null),
        changed: ["a.ts"],
        modifiedAt: () => "2026-01-01T00:00:00.500Z",
      },
    );
    const ids = replay.steps.map((s) => s.id);
    expect(ids.indexOf("untracked:a.ts")).toBe(ids.indexOf("w1") + 1);
    expect(play(replay).contentAt("a.ts", replay.steps.length)).toBe("one\ntwo\n");
  });

  it("ends in the repository's end state, whatever happened in between", () => {
    const final: Record<string, string | null> = {
      "a.ts": "A2\n",
      "b.ts": null,
      "c.ts": "generated\n",
    };
    const base: Record<string, string | null> = {
      "a.ts": "A0\n",
      "b.ts": "B0\n",
      "c.ts": null,
    };
    const replay = run(
      [
        prompt("go"),
        ...edit("e1", "a.ts", "A0\n", "A0", "A1"),
        ...bash("b1", "sed -i s/A1/A2/ a.ts && rm b.ts"),
        ...bash("b2", "pnpm codegen"),
      ],
      {
        readBase: (path) => base[path] ?? null,
        readFinal: (path) => final[path] ?? null,
        changed: ["a.ts", "b.ts", "c.ts"],
      },
    );
    const playback = play(replay);
    for (const [path, content] of Object.entries(final)) {
      expect(playback.contentAt(path, playback.length)).toBe(content);
      expect(playback.contentAt(path, 0)).toBe(base[path]);
    }
  });

  it("skips failed edits and gives their narration to the retry", () => {
    const replay = run([
      prompt("go"),
      say("Trying the edit."),
      call("e1", "Edit", {
        file_path: `${ROOT}/a.ts`,
        old_string: "nope",
        new_string: "x",
      }),
      result("e1", "Error", { error: true, text: "String not found" }),
      ...edit("e2", "a.ts", "yes\n", "yes", "YES"),
    ]);
    expect(replay.steps.map((s) => s.id)).toEqual(["prompt:u-0", "e2"]);
    expect(replay.steps[1]).toMatchObject({ why: "Trying the edit." });
  });

  it("keeps failing commands, which are often the point", () => {
    const replay = run([
      prompt("go"),
      call("b1", "Bash", { command: "pnpm test" }),
      result("b1", "Error: 1 failed", { error: true, text: "1 failed" }),
    ]);
    expect(replay.steps[1]).toMatchObject({
      kind: "command",
      failed: true,
      output: "1 failed",
    });
  });

  it("ignores files outside the repository", () => {
    const replay = run([
      prompt("go"),
      call("w1", "Write", { file_path: "/tmp/scratch.ts", content: "x" }),
      result("w1", { type: "create", originalFile: null }),
    ]);
    expect(replay.files).toEqual({});
    expect(replay.steps).toHaveLength(1);
  });

  it("strips injected context from prompts and redacts secrets from commands", () => {
    const replay = run([
      prompt("<system-reminder>be nice</system-reminder>Deploy it"),
      ...bash(
        "b1",
        "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123'",
        "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 by someone@example.com\nCLAUDE_CODE_ACCOUNT_UUID=2bb7-0000\nCONTAINER_ID=c-123",
      ),
    ]);
    expect(replay.title).toBe("Deploy it");
    const step = replay.steps[1];
    expect(step).toMatchObject({ kind: "command" });
    expect(JSON.stringify(step)).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
    expect(JSON.stringify(step)).toContain("[redacted]");
    expect(JSON.stringify(step)).not.toContain("someone@example.com");
    expect(JSON.stringify(step)).not.toContain("2bb7-0000");
    expect(JSON.stringify(step)).not.toContain("c-123");
  });

  it("replays a heredoc as the write it is, right after its command", () => {
    const replay = run(
      [
        prompt("go"),
        ...bash("b1", "cat > src/new.ts <<'EOF'\nconst a = 1;\nEOF"),
        ...bash("b2", "pnpm test"),
        ...edit("e1", "src/new.ts", "const a = 1;\n", "1", "2"),
      ],
      { readBase: () => null },
    );
    expect(replay.steps.map((s) => s.id)).toEqual([
      "prompt:u-0",
      "b1",
      "b1~0",
      "b2",
      "e1",
    ]);
    expect(replay.steps[2]).toMatchObject({
      kind: "write",
      via: "b1",
      path: "src/new.ts",
    });
    const playback = play(replay);
    expect(playback.contentAt("src/new.ts", 3)).toBe("const a = 1;\n");
    expect(playback.contentAt("src/new.ts", 5)).toBe("const a = 2;\n");
  });

  it("places a drift right after the command that caused it", () => {
    const replay = run(
      [
        prompt("go"),
        ...bash("b1", `python3 -c "open('src/new.ts','w').write('const a = 1;')"`),
        ...bash("b2", "pnpm test"),
        ...edit("e1", "src/new.ts", "const a = 1;\n", "1", "2"),
      ],
      { readBase: () => null },
    );
    expect(replay.steps.map((s) => s.id)).toEqual([
      "prompt:u-0",
      "b1",
      "drift:e1",
      "b2",
      "e1",
    ]);
    expect(replay.files).toEqual({ "src/new.ts": null });
    const playback = play(replay);
    expect(playback.contentAt("src/new.ts", 3)).toBe("const a = 1;\n");
    expect(playback.contentAt("src/new.ts", 5)).toBe("const a = 2;\n");
  });

  it("records that a lockfile changed without storing it", () => {
    const replay = run([prompt("go"), ...bash("b1", "pnpm install")], {
      readBase: (path) => (path === "pnpm-lock.yaml" ? "lock: 1\n" : null),
      readFinal: (path) => (path === "pnpm-lock.yaml" ? "lock: 2\n" : null),
      changed: ["pnpm-lock.yaml"],
    });
    expect(replay.omitted).toEqual(["pnpm-lock.yaml"]);
    expect(replay.files).toEqual({ "pnpm-lock.yaml": "" });
    expect(replay.steps[2]).toMatchObject({
      path: "pnpm-lock.yaml",
      omitted: true,
      cause: "b1",
    });
    const playback = play(replay);
    expect(playback.filesAt(playback.length)[0]).toMatchObject({
      status: "modified",
      omitted: true,
    });
    expect(playback.totals.files).toBe(1);
  });

  it("does not store oversized bodies, but still replays around them", () => {
    const big = "x".repeat(100);
    const replay = run([prompt("go"), ...write("w1", "big.txt", big, null)], {
      maxFileBytes: 50,
    });
    expect(replay.omitted).toEqual(["big.txt"]);
    expect(replay.steps[1]).toMatchObject({ content: "" });
  });

  it("splits a MultiEdit into ordered steps with stable ids", () => {
    const replay = run([
      prompt("go"),
      call("m1", "MultiEdit", {
        file_path: `${ROOT}/a.ts`,
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "b", new_string: "c" },
        ],
      }),
      result("m1", { originalFile: "a\n" }),
    ]);
    expect(replay.steps.map((s) => s.id)).toEqual(["prompt:u-0", "m1.0", "m1.1"]);
    const playback = play(replay);
    expect(playback.contentAt("a.ts", playback.length)).toBe("c\n");
  });
});

describe("annotate", () => {
  it("merges notes by step id and reports the ones that match nothing", () => {
    const replay = run([prompt("go"), ...write("w1", "a.ts", "a\n", null)]);
    const notes = readNotes({
      w1: { text: "New module; check the export name.", level: "review" },
      nope: "orphan",
      w2: { level: "risk" },
    });
    const { replay: annotated, unknown } = annotate(replay, notes);
    expect(annotated.notes).toEqual({
      w1: { text: "New module; check the export name.", level: "review" },
    });
    expect(unknown).toEqual(["nope"]);
  });
});
