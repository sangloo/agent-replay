/**
 * The `apply_patch` format — how Codex (and agents modelled on it) edit
 * files — parsed, and applied to a file the replay is tracking.
 *
 *   *** Begin Patch
 *   *** Add File: src/new.ts
 *   +export const a = 1;
 *   *** Update File: src/old.ts
 *   *** Move to: src/renamed.ts
 *   @@ function outer() {
 *    context
 *   -removed
 *   +added
 *   *** End of File
 *   *** Delete File: src/gone.ts
 *   *** End Patch
 *
 * A patch carries no line numbers and no copy of the file, only context, so
 * applying one needs the file's current content — which is why capture, the
 * only place that tracks it, does the applying. Matching follows the
 * reference implementation's leniency: exact, then ignoring trailing
 * whitespace, then ignoring surrounding whitespace.
 */

export interface PatchChunk {
  /** The `@@ …` line: search for it first, then match after it. */
  context?: string;
  oldLines: string[];
  newLines: string[];
  /** `*** End of File`: the chunk is anchored to the end. */
  eof: boolean;
}

export type FilePatch =
  | { op: "add"; path: string; content: string }
  | { op: "delete"; path: string }
  | { op: "update"; path: string; moveTo?: string; chunks: PatchChunk[] };

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";

/** The patch inside `text`, which may be wrapped in a heredoc or a command. */
export function extractPatch(text: string): string | undefined {
  const start = text.indexOf(BEGIN);
  if (start < 0) return undefined;
  const end = text.indexOf(END, start);
  return text.slice(start, end < 0 ? undefined : end + END.length);
}

export function parsePatch(text: string): FilePatch[] {
  const body = extractPatch(text);
  if (!body) return [];
  const lines = body.split("\n").map((line) => line.replace(/\r$/, ""));
  const files: FilePatch[] = [];
  let i = 0;
  const directive = (line: string) =>
    line.startsWith("*** ") && line.trim() !== "*** End of File";

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length).trim();
      const content: string[] = [];
      i++;
      while (i < lines.length && !directive(lines[i]!)) {
        const added = lines[i]!;
        if (added.startsWith("+")) content.push(added.slice(1));
        i++;
      }
      files.push({
        op: "add",
        path,
        content: content.length ? `${content.join("\n")}\n` : "",
      });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      files.push({ op: "delete", path: line.slice("*** Delete File: ".length).trim() });
      i++;
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      const patch: FilePatch & { op: "update" } = {
        op: "update",
        path: line.slice("*** Update File: ".length).trim(),
        chunks: [],
      };
      i++;
      if (lines[i]?.startsWith("*** Move to: ")) {
        patch.moveTo = lines[i]!.slice("*** Move to: ".length).trim();
        i++;
      }
      let chunk: PatchChunk | undefined;
      const open = (context?: string) => {
        chunk = { oldLines: [], newLines: [], eof: false };
        if (context) chunk.context = context;
        patch.chunks.push(chunk);
        return chunk;
      };
      while (i < lines.length && !directive(lines[i]!)) {
        const text = lines[i]!;
        if (text.startsWith("@@")) {
          open(text.slice(2).trim() || undefined);
        } else if (text.trim() === "*** End of File") {
          if (chunk) chunk.eof = true;
        } else {
          const current = chunk ?? open();
          const mark = text[0];
          const rest = text.slice(1);
          if (mark === "+") current.newLines.push(rest);
          else if (mark === "-") current.oldLines.push(rest);
          else {
            // Context — and a bare empty line is an empty context line.
            const context = mark === " " ? rest : text;
            current.oldLines.push(context);
            current.newLines.push(context);
          }
        }
        i++;
      }
      files.push(patch);
      continue;
    }
    i++;
  }
  return files;
}

const LENIENCE: ((line: string) => string)[] = [
  (line) => line,
  (line) => line.trimEnd(),
  (line) => line.trim(),
];

function seek(
  lines: readonly string[],
  pattern: readonly string[],
  from: number,
  eof: boolean,
): number {
  if (pattern.length === 0) return from;
  if (pattern.length > lines.length) return -1;
  const last = lines.length - pattern.length;
  for (const norm of LENIENCE) {
    const matches = (at: number) =>
      pattern.every((line, k) => norm(lines[at + k]!) === norm(line));
    if (eof && last >= from && matches(last)) return last;
    for (let at = from; at <= last; at++) if (matches(at)) return at;
  }
  return -1;
}

/**
 * The file after applying `chunks`, or `undefined` when a chunk's context is
 * not in the file — the replay then leaves the file alone and lets drift or
 * reconciliation show the real result.
 */
export function applyChunks(
  content: string,
  chunks: readonly PatchChunk[],
): string | undefined {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const replacements: { at: number; remove: number; insert: string[] }[] = [];
  let cursor = 0;

  for (const chunk of chunks) {
    if (chunk.context) {
      const at = seek(lines, [chunk.context], cursor, false);
      if (at < 0) return undefined;
      cursor = at + 1;
    }
    if (chunk.oldLines.length === 0) {
      replacements.push({ at: lines.length, remove: 0, insert: chunk.newLines });
      continue;
    }
    let old = chunk.oldLines;
    let fresh = chunk.newLines;
    let at = seek(lines, old, cursor, chunk.eof);
    if (at < 0 && old.at(-1) === "") {
      // A trailing blank context line that the file does not have.
      old = old.slice(0, -1);
      fresh = fresh.at(-1) === "" ? fresh.slice(0, -1) : fresh;
      at = seek(lines, old, cursor, chunk.eof);
    }
    if (at < 0) return undefined;
    replacements.push({ at, remove: old.length, insert: fresh });
    cursor = at + old.length;
  }

  // Applied from the end so earlier offsets stay true; two insertions at the
  // same line go in reverse chunk order, so they land in the order written.
  const ordered = replacements
    .map((replacement, index) => ({ ...replacement, index }))
    .sort((a, b) => b.at - a.at || b.index - a.index);
  for (const { at, remove, insert } of ordered) {
    lines.splice(at, remove, ...insert);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
