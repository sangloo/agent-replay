import { describe, expect, it } from "vitest";

import { checkKind, concernsOf, evidenceOf } from "./evidence.ts";
import { REPLAY_VERSION, type Replay, type Step } from "./format.ts";
import { play } from "./play.ts";

const at = "2026-01-01T00:00:00.000Z";
const base = { at, agent: "main", turn: 0 };

function replayOf(steps: Step[], files: Record<string, string | null> = {}): Replay {
  return {
    version: REPLAY_VERSION,
    id: "s",
    title: "t",
    source: "claude-code",
    repo: { name: "r", commits: [] },
    files,
    steps,
    notes: {},
    omitted: [],
    startedAt: at,
    endedAt: at,
  };
}

const run = (id: string, command: string, output = "", failed = false): Step => ({
  kind: "command",
  id,
  ...base,
  command,
  output,
  ...(failed ? { failed } : {}),
});

describe("checkKind", () => {
  it("knows runners by their command line, not by a file that names one", () => {
    expect(checkKind("pnpm test")).toBe("test");
    expect(checkKind("cd pkg && npx vitest run src/a.test.ts")).toBe("test");
    expect(checkKind("npx tsc --noEmit")).toBe("typecheck");
    expect(checkKind("pnpm lint")).toBe("lint");
    expect(checkKind("pnpm build")).toBe("build");
    expect(checkKind("cat vitest.config.ts")).toBeUndefined();
    expect(checkKind("cat > a.ts <<'EOF'\npnpm test\nEOF")).toBeUndefined();
  });
});

describe("evidenceOf", () => {
  it("sees a failure a pipe swallowed, and what changed after the last pass", () => {
    const replay = replayOf(
      [
        { kind: "write", id: "w1", ...base, path: "src/a.ts", content: "a\n" },
        run("t1", "pnpm test 2>&1 | tail -5", "Tests  1 failed | 3 passed (4)"),
        {
          kind: "edit",
          id: "e1",
          ...base,
          path: "src/a.ts",
          oldString: "a",
          newString: "b",
          replaceAll: false,
        },
        run("t2", "pnpm test", "Tests  4 passed (4)"),
        {
          kind: "edit",
          id: "e2",
          ...base,
          path: "src/b.ts",
          oldString: "x",
          newString: "y",
          replaceAll: false,
        },
        { kind: "say", id: "s1", ...base, text: "Done. All tests pass now." },
      ],
      { "src/b.ts": "x\n" },
    );
    const ledger = evidenceOf(replay);
    expect(ledger.checks).toMatchObject([
      {
        index: 1,
        kind: "test",
        passed: false,
        masked: true,
        summary: "1 failed | 3 passed (4)",
      },
      { index: 3, kind: "test", passed: true, summary: "4 passed (4)" },
    ]);
    expect(ledger.unresolved).toEqual([]);
    expect(ledger.unverified).toEqual(["src/b.ts"]);
    expect(ledger.latest[0]).toMatchObject({
      kind: "test",
      changedAfter: ["src/b.ts"],
    });
    // The claim came after a change no test run saw.
    expect(ledger.claims).toEqual([
      { index: 5, kind: "test", text: "All tests pass now." },
    ]);
  });

  it("backs a claim with a passing run after the last change", () => {
    const replay = replayOf([
      { kind: "write", id: "w1", ...base, path: "a.ts", content: "a\n" },
      run("t1", "npx vitest run", "Tests  2 passed (2)"),
      { kind: "say", id: "s1", ...base, text: "Tests pass." },
    ]);
    expect(evidenceOf(replay).claims).toEqual([
      { index: 2, kind: "test", text: "Tests pass.", backedBy: 1 },
    ]);
  });

  it("flags an edit that takes assertions out of a test, or skips one", () => {
    const before = "it('a', () => {\n  expect(a).toBe(1);\n  expect(b).toBe(2);\n});\n";
    const after = "it.skip('a', () => {\n  expect(a).toBe(1);\n});\n";
    const replay = replayOf(
      [{ kind: "write", id: "w1", ...base, path: "src/a.test.ts", content: after }],
      { "src/a.test.ts": before },
    );
    const playback = play(replay);
    const ledger = evidenceOf(replay, (i) => playback.frames[i]?.change);
    expect(ledger.testEdits).toEqual([
      {
        index: 0,
        path: "src/a.test.ts",
        concerns: ["2 assertions fewer", "1 test skipped or focused"],
      },
    ]);
    expect(ledger.unverified).toEqual(["src/a.test.ts"]);
  });

  it("lists a failing check nothing fixed", () => {
    const ledger = evidenceOf(
      replayOf([run("t1", "pnpm typecheck", "error TS2322: nope", true)]),
    );
    expect(ledger.unresolved).toMatchObject([{ index: 0, kind: "typecheck" }]);
    expect(concernsOf(ledger)).toEqual([{ kind: "unresolved", steps: [0] }]);
  });

  it("does not call a run stale because a readme changed after it", () => {
    const ledger = evidenceOf(
      replayOf([
        { kind: "write", id: "w1", ...base, path: "src/a.ts", content: "a\n" },
        run("t1", "pnpm test", "Tests  1 passed (1)"),
        { kind: "write", id: "w2", ...base, path: "README.md", content: "# a\n" },
        { kind: "say", id: "s1", ...base, text: "All tests pass." },
      ]),
    );
    expect(ledger.unverified).toEqual([]);
    expect(ledger.claims[0]?.backedBy).toBe(1);
    expect(concernsOf(ledger)).toEqual([]);
  });
});
