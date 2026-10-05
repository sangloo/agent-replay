/**
 * Where two versions of a text differ, as hunks a player can type out.
 *
 * A hunk is a character range of the BEFORE text and what replaces it. Hunks
 * are sorted and never overlap, so a player can show any mix of applied and
 * unapplied hunks by walking the before text once — which is exactly what an
 * animation that types one hunk after another needs.
 *
 * Line diff first (Myers), then each hunk is tightened to the characters that
 * actually differ. The line pass keeps unrelated edits in separate hunks; the
 * character pass is what makes `answer = 41` → `answer = 42` type one digit
 * rather than retype the line.
 */

export interface Hunk {
  /** Offset into the before text. */
  at: number;
  /** The before text's characters at `at` that go away. */
  remove: string;
  /** What takes their place. */
  insert: string;
}

/** Lines with their terminators, so joining them gives the text back. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export type Op = "=" | "-" | "+";

/**
 * Lines as small integers, equal exactly when the lines are: the search
 * compares numbers rather than strings, which on long lines is most of its
 * time.
 */
function intern(a: readonly string[], b: readonly string[]): [Int32Array, Int32Array] {
  const ids = new Map<string, number>();
  const encode = (lines: readonly string[]) => {
    const out = new Int32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let id = ids.get(line);
      if (id === undefined) {
        id = ids.size;
        ids.set(line, id);
      }
      out[i] = id;
    }
    return out;
  };
  return [encode(a), encode(b)];
}

/**
 * Myers' O(ND) diff over lines. Gives up (undefined) past `budget` units of
 * work — a rewritten 20,000-line file is one hunk to a reviewer anyway.
 *
 * Each round keeps only the diagonals it can reach (`-d…d`), so the trace
 * the path is read back from costs D² rather than D × (N + M): most diffs a
 * replay asks for are a few changes in a long file.
 */
function myers(
  lines: readonly string[],
  others: readonly string[],
  budget: number,
): Op[] | undefined {
  const n = lines.length;
  const m = others.length;
  // A new or emptied file is all one kind of op: skip the search, which
  // would otherwise do its full D×(N+M) work for the most common case.
  if (n === 0) return others.map((): Op => "+");
  if (m === 0) return lines.map((): Op => "-");
  const [a, b] = intern(lines, others);
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    if (d * (max + 1) > budget) return undefined;
    // What round d reads: diagonals -d-1…d+1 as round d-1 left them.
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
      let x = down ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return undefined;
}

function backtrack(trace: readonly Int32Array[], n: number, m: number): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d]!;
    // Round d's slice starts at diagonal -d-1.
    const at = (k: number) => v[k + d + 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push("=");
      x--;
      y--;
    }
    ops.push(down ? "+" : "-");
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push("=");
    x--;
    y--;
  }
  return ops.reverse();
}

/** Shrink a hunk to the characters that differ. */
function tighten(hunk: Hunk): Hunk {
  const { remove, insert } = hunk;
  const most = Math.min(remove.length, insert.length);
  let head = 0;
  while (head < most && remove[head] === insert[head]) head++;
  let tail = 0;
  while (
    tail < most - head &&
    remove[remove.length - 1 - tail] === insert[insert.length - 1 - tail]
  ) {
    tail++;
  }
  return {
    at: hunk.at + head,
    remove: remove.slice(head, remove.length - tail),
    insert: insert.slice(head, insert.length - tail),
  };
}

const DIFF_BUDGET = 4_000_000;

/**
 * A line-level edit script from `before` to `after`: one op per line of
 * either, `=` kept, `-` removed, `+` inserted. What line blame follows.
 */
export function diffLines(before: string, after: string): Op[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const middle: Op[] = myers(midA, midB, DIFF_BUDGET) ?? [
    ...midA.map((): Op => "-"),
    ...midB.map((): Op => "+"),
  ];
  return [
    ...Array.from({ length: head }, (): Op => "="),
    ...middle,
    ...Array.from({ length: tail }, (): Op => "="),
  ];
}

/** The hunks that turn `before` into `after`. Empty when they are equal. */
export function diffHunks(before: string, after: string): Hunk[] {
  if (before === after) return [];
  const a = splitLines(before);
  const b = splitLines(after);

  // Common head and tail are free, and usually most of the file.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  let at = 0;
  for (let i = 0; i < head; i++) at += a[i]!.length;

  const ops = myers(midA, midB, DIFF_BUDGET);
  if (!ops) {
    return [tighten({ at, remove: midA.join(""), insert: midB.join("") })];
  }

  const hunks: Hunk[] = [];
  let open: Hunk | undefined;
  let ia = 0;
  let ib = 0;
  for (const op of ops) {
    if (op === "=") {
      if (open) hunks.push(tighten(open));
      open = undefined;
      at += midA[ia]!.length;
      ia++;
      ib++;
      continue;
    }
    open ??= { at, remove: "", insert: "" };
    if (op === "-") {
      open.remove += midA[ia]!;
      at += midA[ia]!.length;
      ia++;
    } else {
      open.insert += midB[ib]!;
      ib++;
    }
  }
  if (open) hunks.push(tighten(open));
  return hunks.filter((h) => h.remove !== "" || h.insert !== "");
}

/** Apply hunks (sorted, non-overlapping, in before coordinates). */
export function applyHunks(before: string, hunks: readonly Hunk[]): string {
  let out = "";
  let cursor = 0;
  for (const hunk of hunks) {
    out += before.slice(cursor, hunk.at) + hunk.insert;
    cursor = hunk.at + hunk.remove.length;
  }
  return out + before.slice(cursor);
}

/**
 * Lines added and removed across a set of hunks, for a step's `+a −r` — in
 * git's terms, so a line that only gained a comma is one out and one in.
 * Hunks are tightened to the characters that changed, so each is widened
 * back to the whole lines it touches in `before` before counting.
 */
export function countLines(
  hunks: readonly Hunk[],
  before: string,
): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    const end = hunk.at + hunk.remove.length;
    const start = lineStart(before, hunk.at);
    const stop =
      end === before.length || lineStart(before, end) === end
        ? end
        : lineEnd(before, end);
    const head = before.slice(start, hunk.at);
    const tail = before.slice(end, stop);
    added += lineSpan(head + hunk.insert + tail);
    removed += lineSpan(before.slice(start, stop));
  }
  return { added, removed };
}

function lineStart(text: string, at: number): number {
  return at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
}

function lineEnd(text: string, at: number): number {
  const next = text.indexOf("\n", at);
  return next === -1 ? text.length : next + 1;
}

function lineSpan(text: string): number {
  if (text === "") return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}
