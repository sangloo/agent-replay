/**
 * Files a shell command writes whose content is in the command itself.
 *
 * Agents increasingly write files through the shell rather than an edit
 * tool — `cat > file <<'EOF'` above all. Without this, such a file only
 * appears when something later reads it, or at the end, in one lump; with
 * it, the write is replayed where it happened, with the exact text.
 *
 * Deliberately narrow: only a heredoc fed to `cat` or `tee`, whose output
 * goes to a named file. A heredoc fed to `python3 -` writes whatever the
 * script prints, and an unquoted delimiter whose body holds `$`, a backtick
 * or a backslash is expanded by the shell first — neither is literal text,
 * so both are left to drift and reconciliation, which see the real result.
 */

import { dirAt } from "./cause.ts";
import { resolvePath } from "./paths.ts";

export interface ShellWrite {
  /** Absolute when the command's directory is known, else as written. */
  path: string;
  content: string;
  /** `>>` or `tee -a`: the content goes after what is there. */
  append: boolean;
}

const HEREDOC = /<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|(\\?)([A-Za-z_][\w.-]*))/g;
const REDIRECT = /(?<![\d&<>=-])(>>?)[ \t]*(["']?)([^\s"'<>|;&()]+)\2/g;
const TEE = /^\s*tee\s+((?:-a\s+|--append\s+)?)(["']?)([^\s"'<>|;&()]+)\2/;
const SEGMENT = /&&|\|\||;|\|/g;

interface Segment {
  text: string;
  start: number;
  /** Joined to the next segment by a pipe. */
  piped: boolean;
}

function segments(line: string): Segment[] {
  const out: Segment[] = [];
  let start = 0;
  for (const match of line.matchAll(SEGMENT)) {
    out.push({ text: line.slice(start, match.index), start, piped: match[0] === "|" });
    start = match.index + match[0].length;
  }
  out.push({ text: line.slice(start), start, piped: false });
  return out;
}

const command = (segment: string) =>
  segment
    .trim()
    .replace(/^(?:\w+=\S*\s+)*/, "")
    .split(/\s+/)[0] ?? "";

/** Where the heredoc starting at `offset` of `line` ends up, if in a file. */
function targetOf(
  line: string,
  offset: number,
): { target: string; append: boolean } | undefined {
  const parts = segments(line);
  const at = parts.findIndex(
    (part, i) =>
      offset >= part.start && (i === parts.length - 1 || offset < parts[i + 1]!.start),
  );
  const own = parts[at];
  if (!own) return undefined;
  const name = command(own.text);
  if (name === "cat") {
    for (const match of own.text.matchAll(REDIRECT)) {
      const target = match[3]!;
      if (target.startsWith("/dev/")) continue;
      return { target, append: match[1] === ">>" };
    }
    const next = own.piped ? parts[at + 1] : undefined;
    const tee = next?.text.match(TEE);
    return tee ? { target: tee[3]!, append: Boolean(tee[1]) } : undefined;
  }
  if (name === "tee") {
    const tee = own.text.match(TEE);
    return tee ? { target: tee[3]!, append: Boolean(tee[1]) } : undefined;
  }
  return undefined;
}

/** The literal file writes in `command`, in order. */
export function shellWrites(command: string, cwd?: string): ShellWrite[] {
  const lines = command.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const writes: ShellWrite[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let next = i + 1;
    for (const op of line.matchAll(HEREDOC)) {
      const strip = op[1] === "-";
      const literal = op[2] !== undefined || op[3] !== undefined || op[4] === "\\";
      const delimiter = op[2] ?? op[3] ?? op[5]!;
      const body: string[] = [];
      let end = next;
      for (; end < lines.length; end++) {
        const text = strip ? lines[end]!.replace(/^\t+/, "") : lines[end]!;
        if (text === delimiter) break;
        body.push(text);
      }
      // Never closed: not a heredoc this parser understands.
      if (end >= lines.length) return writes;
      next = end + 1;
      const content = body.length ? `${body.join("\n")}\n` : "";
      if (!literal && /[$`\\]/.test(content)) continue;
      const found = targetOf(line, op.index);
      if (!found) continue;
      const dir = cwd ? dirAt(command, cwd, starts[i]! + op.index) : undefined;
      const path = found.target.startsWith("/")
        ? found.target
        : dir
          ? resolvePath(dir, found.target)
          : found.target;
      writes.push({ path, content, append: found.append });
    }
    i = next - 1;
  }
  return writes;
}
