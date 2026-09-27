// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { readPayload } from "./hook.ts";
import { hookCommand, installClaude } from "./setup.ts";

const temp = mkdtempSync(join(tmpdir(), "replay-setup-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("installClaude", () => {
  it("adds the Stop hook once, keeping what was there", () => {
    const file = join(temp, "settings.json");
    writeFileSync(
      file,
      JSON.stringify({
        model: "x",
        hooks: { Stop: [{ hooks: [{ type: "command", command: "say hi" }] }] },
      }),
    );
    expect(installClaude(file, hookCommand())).toBe("added");
    expect(installClaude(file, hookCommand())).toBe("present");
    const settings = JSON.parse(readFileSync(file, "utf8"));
    expect(settings.model).toBe("x");
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop[1].hooks[0].command).toMatch(
      /replay\.mjs" hook 2>\/dev\/null \|\| true$/,
    );
  });

  it("writes a project hook relative to the project, so it travels", () => {
    const project = join(import.meta.dirname, "..", "..", "..");
    expect(hookCommand(project)).toBe(
      'node "$CLAUDE_PROJECT_DIR/packages/app/bin/replay.mjs" hook',
    );
  });

  it("recognises a hook installed in the older form, and never adds a second", () => {
    const file = join(temp, "older.json");
    const older = 'node "/x/apps/replay/server/cli.ts" hook 2>/dev/null || true';
    writeFileSync(
      file,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: older }] }] },
      }),
    );
    expect(installClaude(file, hookCommand())).toBe("present");
  });
});

describe("readPayload", () => {
  it("reads Codex's notify argument", () => {
    expect(
      readPayload([
        "--agent",
        '{"type":"agent-turn-complete","thread-id":"t1","cwd":"/r"}',
      ]),
    ).toEqual({ sessionId: "t1", transcriptPath: undefined, cwd: "/r" });
  });
});
