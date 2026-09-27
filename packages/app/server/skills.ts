/**
 * The skills that teach a model to use replay — the same Markdown the Claude
 * Code plugin installs, printable for any other agent (`replay skills teach`).
 * They live in `plugin/skills/` in the repository and `skills/` in the
 * published package.
 */

import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillInfo {
  /** The directory's name: `replay`, `replay-teach`, … */
  name: string;
  description: string;
  file: string;
}

function skillsDir(): string | undefined {
  const server = dirname(fileURLToPath(import.meta.url));
  return [join(server, "../skills"), join(server, "../../../plugin/skills")].find(
    (dir) => existsSync(dir),
  );
}

function frontMatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  const out: Record<string, string> = {};
  for (const line of match?.[1]?.split("\n") ?? []) {
    const at = line.indexOf(":");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

export function skills(): SkillInfo[] {
  const dir = skillsDir();
  if (!dir) return [];
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, "SKILL.md")))
    .sort()
    .map((name) => {
      const file = join(dir, name, "SKILL.md");
      const meta = frontMatter(readFileSync(file, "utf8"));
      const description = meta.description ?? "";
      return {
        name,
        description:
          description.length > 90
            ? `${description.slice(0, 89).trimEnd()}…`
            : description,
        file,
      };
    });
}

/** One skill's Markdown, by name — `teach` finds `replay-teach` too. */
export function skill(name: string): string | undefined {
  const found = skills().find((s) => s.name === name || s.name === `replay-${name}`);
  return found ? readFileSync(found.file, "utf8") : undefined;
}

/**
 * Copy every skill into an agent's skills folder — Claude Code reads
 * `<repo>/.claude/skills/` and `~/.claude/skills/`. Returns the names copied.
 */
export function installSkills(into: string): string[] {
  const all = skills();
  for (const { name, file } of all) {
    cpSync(dirname(file), join(into, name), { recursive: true });
  }
  return all.map((s) => s.name);
}
