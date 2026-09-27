/**
 * What the code pane shows for one file at one moment: a unified diff that
 * is written in front of you, and stays.
 *
 * A change plays on a timeline (`timelineOf`), in beats a reader can follow:
 * the lines about to go are marked first, so the eye lands on them; then the
 * view travels to each hunk in turn and its new lines are typed in beneath
 * the old, at a readable pace, with a caret at the typing point; then the
 * landed change holds for a moment before the next step. Nothing is taken
 * away when it lands: removed lines stay red and added lines green, so a
 * paused or finished replay still says exactly what changed and how.
 *
 * Hunks arrive tightened to the characters that changed. Each is widened
 * back to the whole lines it touches, so a line that gained a comma reads
 * as one line out and one in (as git counts it), with the comma itself
 * emphasised inside the line.
 */

import type { Hunk } from "@agent-replay/core";

export type LineKind = "context" | "removed" | "added";

/** `strong`: the characters that changed, inside a line that changed. */
export type SpanKind = "plain" | "strong";

export interface Span {
  text: string;
  kind: SpanKind;
  /**
   * Where the text comes from, for syntax colour: the file before the
   * change (context and removed lines) or after it (added lines).
   */
  source: "before" | "after";
  /** Offset of `text` in that source. */
  at: number;
}

export interface Line {
  kind: LineKind;
  /** 1-based in the text being produced; `null` for a removed line. */
  number: number | null;
  spans: Span[];
  /** Where the typing caret sits, as an index into `spans`. */
  caret?: number;
  /** Part of the change: the pane scrolls to keep these in view. */
  hot: boolean;
  /** Stable while the line's content is, so unchanged rows skip re-rendering. */
  key: string;
}

/** The two sides of a diff and the hunks between them, in `before`'s coordinates. */
export interface Diffable {
  before: string | null;
  after: string | null;
  hunks: readonly Hunk[];
}

/**
 * The pace of a change at 1×, in seconds; the speed control divides all of
 * it. Slow enough to watch a small edit happen, bounded so a whole new file
 * still arrives in a reasonable time — and every beat can be paused.
 */
export const PACE = {
  /** Showing what is about to go, before anything is typed. */
  mark: 0.9,
  /** Moving to the next hunk of the same change. */
  travel: 0.5,
  /** Typing, at this many characters a second… */
  charsPerSecond: 160,
  /** …within these bounds for one hunk… */
  minType: 0.8,
  maxType: 12,
  /** …and these for all of a step's hunks together. */
  maxTyping: 30,
  /** The landed change, before the next step. */
  hold: 1.2,
} as const;

interface Beat {
  start: number;
  end: number;
}

/** When each beat of a change happens, in seconds at 1× from its start. */
export interface Timeline {
  total: number;
  mark: Beat;
  hunks: { travel: Beat; type: Beat }[];
  hold: Beat;
}

export function timelineOf(diff: Diffable): Timeline {
  const mark = diff.hunks.some((hunk) => hunk.remove) ? PACE.mark : 0;
  let typing = diff.hunks.map((hunk) =>
    Math.min(
      PACE.maxType,
      Math.max(PACE.minType, hunk.insert.length / PACE.charsPerSecond),
    ),
  );
  const sum = typing.reduce((total, seconds) => total + seconds, 0);
  if (sum > PACE.maxTyping)
    typing = typing.map((seconds) => (seconds * PACE.maxTyping) / sum);
  let at = mark;
  const hunks = typing.map((seconds, i) => {
    const travel = { start: at, end: at + (i === 0 ? 0 : PACE.travel) };
    const type = { start: travel.end, end: travel.end + seconds };
    at = type.end;
    return { travel, type };
  });
  const hold = { start: at, end: at + PACE.hold };
  return { total: hold.end, mark: { start: 0, end: mark }, hunks, hold };
}

const atLineStart = (text: string, at: number) => at === 0 || text[at - 1] === "\n";

function lineStart(text: string, at: number): number {
  return at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
}

function lineEnd(text: string, at: number): number {
  const next = text.indexOf("\n", at);
  return next === -1 ? text.length : next + 1;
}

interface Block {
  hunk: Hunk;
  /** The whole lines of `before` the hunk touches: `[start, stop)`. */
  start: number;
  stop: number;
  /** Unchanged text on the hunk's first and last lines. */
  head: string;
  tail: string;
  /** Where the block's new lines start in `after`. */
  afterStart: number;
}

/** Each hunk widened to whole lines on both sides. */
function blocksOf(before: string, hunks: readonly Hunk[]): Block[] {
  let shift = 0;
  return hunks.map((hunk) => {
    const end = hunk.at + hunk.remove.length;
    const start = lineStart(before, hunk.at);
    let stop =
      end === before.length || atLineStart(before, end) ? end : lineEnd(before, end);
    // The new text has to end where a line does too, or the line after the
    // block would read as part of it: "a\nb" → "a\nXb" is b out, Xb in.
    const head = before.slice(start, hunk.at);
    if (
      stop === end &&
      stop < before.length &&
      (head + hunk.insert).length > 0 &&
      !(head + hunk.insert).endsWith("\n")
    ) {
      stop = lineEnd(before, stop);
    }
    const block: Block = {
      hunk,
      start,
      stop,
      head,
      tail: before.slice(end, stop),
      afterStart: start + shift,
    };
    shift += hunk.insert.length - hunk.remove.length;
    return block;
  });
}

/** Lines, built span by span; each line belongs to one kind. */
class Lines {
  readonly out: Line[] = [];
  private spans: Span[] = [];
  private caret: number | undefined;
  private count = 0;

  write(
    text: string,
    kind: SpanKind,
    source: Span["source"],
    at: number,
    line: LineKind,
  ) {
    let offset = at;
    text.split("\n").forEach((part, i) => {
      if (i > 0) this.close(line);
      if (part) this.spans.push({ text: part, kind, source, at: offset });
      offset += part.length + 1;
    });
  }

  placeCaret() {
    this.caret = this.spans.length;
  }

  /** Close a line left open at the end of a block (no newline yet). */
  flush(line: LineKind) {
    if (this.spans.length > 0 || this.caret !== undefined) this.close(line);
  }

  private close(kind: LineKind) {
    const number = kind === "removed" ? null : ++this.count;
    const { spans, caret } = this;
    this.out.push({
      kind,
      number,
      spans,
      caret,
      hot: kind !== "context" || caret !== undefined,
      key: `${kind[0]}${number ?? ""}|${caret ?? ""}|${spans.map((s) => `${s.kind[0]}${s.source[0]}${s.at}:${s.text}`).join("\u0001")}`,
    });
    this.spans = [];
    this.caret = undefined;
  }
}

/**
 * The diff at `progress` (0–1): `1` is the settled diff, which is where a
 * change stays once it has played.
 */
export function composeDiff(diff: Diffable, progress = 1): Line[] {
  const before = diff.before ?? "";
  const lines = new Lines();
  const done = progress >= 1;
  const timeline = done ? undefined : timelineOf(diff);
  const now = timeline ? progress * timeline.total : 0;
  let cursor = 0;

  blocksOf(before, diff.hunks).forEach((block, i) => {
    const { hunk, start, stop, head, tail, afterStart } = block;
    lines.write(before.slice(cursor, start), "plain", "before", cursor, "context");
    lines.flush("context");
    cursor = stop;

    // A change inside a line emphasises the characters; a change of whole
    // lines would only emphasise everything, which is emphasising nothing.
    const inside = head !== "" || tail !== "";
    const changed: SpanKind = inside ? "strong" : "plain";

    lines.write(head, "plain", "before", start, "removed");
    lines.write(hunk.remove, changed, "before", hunk.at, "removed");
    lines.write(tail, "plain", "before", hunk.at + hunk.remove.length, "removed");
    lines.flush("removed");

    // The new lines, as far as they have been typed: none before the view
    // has travelled here, part (with the caret) while typing, all after.
    let typed: string | undefined;
    let caret = false;
    const beats = timeline?.hunks[i];
    if (!timeline || !beats || now >= beats.type.end) {
      typed = hunk.insert;
    } else if (now >= beats.travel.start && now >= timeline.mark.end) {
      const share =
        Math.max(0, now - beats.type.start) / (beats.type.end - beats.type.start || 1);
      typed = hunk.insert.slice(0, Math.floor(share * hunk.insert.length));
      caret = true;
    }
    if (typed === undefined) return;
    if (head === "" && tail === "" && hunk.insert === "") return;
    lines.write(head, "plain", "after", afterStart, "added");
    lines.write(typed, changed, "after", afterStart + head.length, "added");
    if (caret) lines.placeCaret();
    lines.write(
      tail,
      "plain",
      "after",
      afterStart + head.length + hunk.insert.length,
      "added",
    );
    lines.flush("added");
  });

  lines.write(before.slice(cursor), "plain", "before", cursor, "context");
  lines.flush("context");
  return lines.out;
}

/** A file that is not changing, as lines; its text is the "after". */
export function plainLines(content: string): Line[] {
  const lines = new Lines();
  lines.write(content, "plain", "after", 0, "context");
  lines.flush("context");
  return lines.out;
}
