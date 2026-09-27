/**
 * Which shell command most likely made a change no tool call recorded.
 *
 * A guess, and labelled as one in the player ("probably"), but a scored one:
 * the obvious rule — the last command that mentions the file — is wrong
 * whenever a later command merely reads or imports it, which is most of the
 * time. So:
 *
 * 3. the command writes to the path: a redirect, `sed -i`, `rm`, `mv`, `cp`,
 *    `tee`, `git rm|mv|checkout|restore`;
 * 2. the command names the path — a little more when it also writes
 *    something (`open(p, "w")`, an in-place flag), a little less when every
 *    part naming it only reads (`cat`, `grep`, `git diff`) or the command
 *    writes somewhere else (`cat > test.ts` with the path in its text);
 * 1. the command rewrites files it does not name: a formatter, or an
 *    installer when the path is a lockfile.
 *
 * Highest score wins, and among equals the LATEST. One step stands for
 * everything the unrecorded commands did to a file, carrying its content as
 * of the last of them: placed at the first, it would show code before it
 * was written; at the last, it is never early. Reads and writes elsewhere
 * score lower so that "latest" does not hand the change to a `cat`.
 */

import { resolvePath } from "./paths.ts";

const LOCKFILE =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|go\.sum|Cargo\.lock|uv\.lock|poetry\.lock|Gemfile\.lock|composer\.lock)$/;

const INSTALLER =
  /\b(pnpm|npm|yarn|bun)\s+(i|install|add|remove|rm|up|update|uninstall)\b|\bgo\s+(mod\s+tidy|get)\b|\bcargo\s+(add|update|build)\b|\buv\s+(add|sync|lock)\b|\bpoetry\s+(add|lock|install)\b/;

const FORMATTER =
  /\bprettier\b[^\n]*--write|\beslint\b[^\n]*--fix|\b(gofmt|goimports)\b[^\n]*\s-w\b|\bgo\s+fmt\b|\b(pnpm|npm|yarn)\s+(run\s+)?(format|fmt|lint:fix)\b|\bruff\s+(format|check\s+[^\n]*--fix)|\bblack\b|\bbiome\b[^\n]*--write/;

// Redirects are not here: they are write targets, resolved exactly above.
const WRITES_SOMETHING =
  /open\([^)]*,\s*["'][wa]|writeFileSync|writeFile\(|\.write_text\(|\bsed\s+-i|\bperl\s+-[a-z]*i|--write\b/;

// A part of a command that only looks at files.
const READER =
  /^\s*(?:cat|less|more|head|tail|grep|egrep|fgrep|rg|wc|ls|nl|stat|file|diff|cmp|sed\s+-n|git\s+(?:diff|log|show|status|blame|grep))\b/;

/** Every part of `command` that names `name` only reads it. */
function onlyReads(command: string, name: string): boolean {
  const parts = command.split(/&&|\|\||[;|\n]/).filter((part) => part.includes(name));
  // `cat > x` starts like a read and is a write: a redirect disqualifies.
  const quiet = (part: string) => part.replace(/\d?>>?\s*\/dev\/null|\d>&\d/g, "");
  return (
    parts.length > 0 &&
    parts.every((part) => READER.test(part) && !/>/.test(quiet(part)))
  );
}

/** Lockfiles change on every install and nobody reads them in a replay. */
export function isLockfile(path: string): boolean {
  return LOCKFILE.test(path);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REDIRECT = /(?<![=-])>>?\s*(["']?)([^\s"'<>|;&()]+)\1/g;
const WRITER =
  /\b(sed\s+-i\S*|rm|mv|cp|touch|tee|truncate|git\s+(?:rm|mv|checkout|restore))\b([^\n;&|]*)/g;
const CD = /\bcd\s+(["']?)([^\s"';&|()]+)\1/g;

interface WriteTarget {
  target: string;
  offset: number;
  /**
   * A removal: naming a directory removes everything under it. Only for
   * `rm` — `cp x .` names a directory too, and writes one file into it.
   */
  removes: boolean;
}

/** The paths a command writes to, with where in the command each appears. */
function writeTargets(command: string): WriteTarget[] {
  const targets: WriteTarget[] = [];
  for (const match of command.matchAll(REDIRECT)) {
    targets.push({ target: match[2]!, offset: match.index, removes: false });
  }
  for (const match of command.matchAll(WRITER)) {
    const removes = /^(git\s+)?rm$/.test(match[1]!);
    for (const token of match[2]!.split(/\s+/)) {
      const target = token.replace(/^["']|["']$/g, "");
      if (target && !target.startsWith("-")) {
        targets.push({ target, offset: match.index, removes });
      }
    }
  }
  return targets;
}

/**
 * The directory a command is in at `offset`: where it started, moved by
 * every `cd` before that point. `undefined` once it cannot be followed.
 */
export function dirAt(
  command: string,
  cwd: string,
  offset: number,
): string | undefined {
  let dir: string | undefined = cwd;
  for (const match of command.matchAll(CD)) {
    if (match.index >= offset) break;
    const to = match[2]!;
    dir =
      dir === undefined || to === "-" || to.startsWith("~")
        ? undefined
        : resolvePath(dir, to);
  }
  return dir;
}

export interface CommandContext {
  /** The command's starting directory, absolute. */
  cwd?: string;
  /** The repository root, absolute. */
  root?: string;
}

/**
 * @param path repo-relative. With `cwd` and `root`, write targets are
 * resolved as the shell would, so `cd server && cat > capture.ts` is not
 * mistaken for a write to `core/capture.ts`.
 */
export function causeScore(
  command: string,
  path: string,
  context: CommandContext = {},
): number {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const full = context.root ? `${context.root}/${path}` : undefined;
  let named = false;
  let elsewhere = false;
  for (const { target, offset, removes } of writeTargets(command)) {
    if (target.startsWith("/dev/")) continue;
    const dir = context.cwd ? dirAt(command, context.cwd, offset) : undefined;
    if (full && (dir || target.startsWith("/"))) {
      const written = resolvePath(dir ?? "/", target);
      if (written === full || (removes && full.startsWith(`${written}/`))) {
        return 3;
      }
      elsewhere = true;
    } else if (target === path || target.endsWith(`/${path}`)) {
      return 3;
    } else if (target.slice(target.lastIndexOf("/") + 1) === base) {
      // Cannot resolve where it wrote: a claim, but no stronger than naming.
      named = true;
    } else {
      elsewhere = true;
    }
  }
  const name = escape(base);
  const mentioned =
    named ||
    command.includes(path) ||
    (base.length >= 4 && new RegExp(`(?<![\\w-])${name}(?![\\w.-])`).test(command));
  // Naming a file and writing *something* — a script that opens it for
  // writing, an in-place flag — outranks naming it in a read.
  if (mentioned) {
    if (WRITES_SOMETHING.test(command)) return 2.5;
    if (named) return 2;
    return elsewhere || onlyReads(command, base) ? 1.5 : 2;
  }
  if (isLockfile(path) && INSTALLER.test(command)) return 1;
  if (FORMATTER.test(command)) return 1;
  return 0;
}

/** The best-scoring command among `commands`, or -1 — the latest of equals. */
export function likeliestCause(
  commands: readonly { index: number; command: string; cwd?: string }[],
  path: string,
  root?: string,
): number {
  let best = -1;
  let bestScore = 0;
  for (const { index, command, cwd } of commands) {
    const score = causeScore(command, path, { cwd, root });
    if (score > 0 && score >= bestScore) {
      best = index;
      bestScore = score;
    }
  }
  return best;
}
