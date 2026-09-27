/**
 * `replay setup` — wire an agent's end-of-turn hook to `replay hook`.
 *
 * Claude Code's settings format is documented and stable, so setup writes it
 * (merging, never clobbering, and never twice). Codex's and Gemini CLI's hook
 * configuration moves between versions, so setup prints the snippet to paste
 * rather than guessing at a file it could break.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/replay.mjs", import.meta.url));
/** Our hook, however it was quoted or wrapped — its older forms and npx's. */
const MARK =
  /\/bin\/replay\.mjs"?\s+hook\b|replay\/server\/cli\.ts"?\s+hook\b|\bnpx\s+(-y\s+)?\S*replay\S*\s+hook\b|(^|[\s;]|then\s)replay\s+hook\b/;

/** The published package's name, when running from it. */
function packageName(): string | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { name?: string; private?: boolean };
    return manifest.private ? undefined : manifest.name;
  } catch {
    return undefined;
  }
}

/**
 * The command a hook runs. Inside `project`, relative to it, so it travels.
 * Run through `npx`, the CLI lives in a cache that can be cleared, so the
 * hook asks npx for it by name instead of pointing at the cache.
 */
export function hookCommand(project?: string, cli = CLI): string {
  const name = packageName();
  if (name && /[\\/]_npx[\\/]/.test(cli)) return `npx -y ${name} hook`;
  if (project) {
    const rel = relative(project, cli);
    if (!rel.startsWith("..")) return `node "$CLAUDE_PROJECT_DIR/${rel}" hook`;
  }
  return `node "${cli}" hook`;
}

interface HookEntry {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
}

/**
 * Add the Stop hook to a Claude Code settings file. Stop, not SessionEnd:
 * it fires after every turn, so the replay is current even when a session
 * is abandoned rather than ended — and re-capturing replaces the same file.
 */
export function installClaude(file: string, command: string): "added" | "present" {
  let settings: Record<string, unknown> = {};
  if (existsSync(file)) {
    settings = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  }
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  const stop = hooks.Stop ?? [];
  if (
    stop.some((entry) => entry.hooks?.some((hook) => MARK.test(hook.command ?? "")))
  ) {
    return "present";
  }
  stop.push({
    hooks: [{ type: "command", command: `${command} 2>/dev/null || true` }],
  });
  settings.hooks = { ...hooks, Stop: stop };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return "added";
}

export function claudeSettings(scope: "user" | "project", project: string): string {
  return scope === "user"
    ? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json")
    : join(project, ".claude", "settings.json");
}

export function snippets(command: string): string {
  const quoted = command.replace(/^node "(.+)" hook$/, "$1");
  return [
    "Codex — in ~/.codex/config.toml (the notify program receives the turn's JSON):",
    `  notify = ["node", ${JSON.stringify(quoted)}, "hook"]`,
    "",
    "Gemini CLI — in ~/.gemini/settings.json (or .gemini/settings.json in a project):",
    `  "hooks": { "AfterAgent": [{ "hooks": [{ "type": "command", "command": ${JSON.stringify(command)} }] }] }`,
    "",
    "Any other agent: run `replay hook` after a turn with JSON on stdin",
    "  carrying session_id and/or transcript_path, and cwd.",
  ].join("\n");
}
