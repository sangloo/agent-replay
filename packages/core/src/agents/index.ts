/**
 * Which agent wrote a log, and its adapter. Detection reads the first lines
 * only: every supported format says who it is near the top.
 */

import { jsonLines, logText, type Log, type Transcript } from "../transcript.ts";
import { CLAUDE_CODE, isClaudeCode, parseClaudeCode } from "./claude-code.ts";
import { CODEX, isCodex, parseCodex } from "./codex.ts";
import { GEMINI_CLI, isGeminiCli, parseGeminiCli } from "./gemini-cli.ts";

export interface Adapter {
  id: string;
  /** Human name, for the player. */
  name: string;
  detect: (firstLines: readonly Record<string, unknown>[]) => boolean;
  parse: (log: Log, agent?: string) => Transcript;
}

export const ADAPTERS: readonly Adapter[] = [
  {
    id: CLAUDE_CODE,
    name: "Claude Code",
    detect: isClaudeCode,
    parse: parseClaudeCode,
  },
  { id: CODEX, name: "Codex", detect: isCodex, parse: parseCodex },
  { id: GEMINI_CLI, name: "Gemini CLI", detect: isGeminiCli, parse: parseGeminiCli },
];

/** The first few kilobytes' worth of lines. */
function start(log: Log): Log {
  if (typeof log === "string") return log.slice(0, 256 * 1024);
  const out: string[] = [];
  let size = 0;
  for (const line of log) {
    out.push(line.slice(0, 256 * 1024));
    size += line.length;
    if (size >= 256 * 1024) break;
  }
  return out;
}

function head(log: Log, lines = 20): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const entry of jsonLines(start(log))) {
    out.push(entry);
    if (out.length >= lines) break;
  }
  // A single pretty-printed JSON document (Gemini CLI's older format).
  if (out.length === 0) {
    try {
      const whole: unknown = JSON.parse(logText(log));
      if (typeof whole === "object" && whole !== null && !Array.isArray(whole)) {
        out.push(whole as Record<string, unknown>);
      }
    } catch {
      // Neither JSONL nor JSON.
    }
  }
  return out;
}

export function detectAdapter(log: Log): Adapter | undefined {
  const first = head(log);
  return ADAPTERS.find((adapter) => adapter.detect(first));
}

/** Any supported agent's session log, as a transcript. */
export function parseTranscript(log: Log, agent = "main"): Transcript {
  const adapter = detectAdapter(log) ?? ADAPTERS[0]!;
  return adapter.parse(log, agent);
}

export function agentName(id: string): string {
  if (id === "git") return "Git history";
  return ADAPTERS.find((adapter) => adapter.id === id)?.name ?? id;
}
