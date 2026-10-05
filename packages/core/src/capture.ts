/**
 * Transcript → replay.
 *
 * Walks the session's events in time order and emits a step per prompt, per
 * file change and per shell command, carrying the agent's own prose as each
 * step's `why`. It tracks every touched file's content as it goes, which is
 * what lets it be honest about the changes the transcript does NOT describe:
 *
 * - **Drift.** Every Edit and Write result records the file as the tool found
 *   it. When that differs from the state the replay has built, something
 *   else changed the file in between — a formatter, a `sed`, a codegen step —
 *   and an `external` step is inserted at that point, attributed to the
 *   command that names the file when one does.
 * - **Reconciliation.** At the end, every touched file and every file git
 *   reports as changed is compared with the real end state. Whatever still
 *   differs (a file deleted with `rm`, a lockfile rewritten by an install)
 *   becomes an `external` step after the command that most likely did it.
 *
 * So the replay's end state is the repository's end state, and every byte of
 * the difference from the base is either a recorded tool call or a change
 * explicitly marked as not being one.
 *
 * Pure: git and the filesystem arrive as functions, so this runs, and is
 * tested, without either.
 */

import { applyEdit } from "./apply.ts";
import { isLockfile, likeliestCause } from "./cause.ts";
import { diffHunks } from "./diff.ts";
import {
  REPLAY_DIR,
  REPLAY_VERSION,
  type CommandStep,
  type ExternalStep,
  type Note,
  type Replay,
  type ReplayRepo,
  type Step,
} from "./format.ts";
import { applyChunks } from "./patch.ts";
import { shellWrites } from "./shell.ts";
import { redact, truncate } from "./redact.ts";
import type { Transcript } from "./transcript.ts";

export interface CaptureOptions {
  /** Absolute path of the repository root; only files under it are kept. */
  root: string;
  /** Other spellings of `root` the log may use — a symlinked path, say. */
  aliases?: readonly string[];
  repo: ReplayRepo;
  /**
   * A file's content at the base commit: `null` if it did not exist,
   * `undefined` if unknown — the first content a tool observed is then used.
   */
  readBase?: (path: string) => string | null | undefined;
  /**
   * A file's content at the end of the session. Without it there is no
   * reconciliation, and changes made purely by commands are missing.
   */
  readFinal?: (path: string) => string | null;
  /**
   * When a file was last written, as an ISO time — its modification time.
   * A change no recorded command explains is placed at that moment rather
   * than at the end, so edits made outside the session's tools (another
   * agent, an editor, a script) show up when they happened.
   */
  modifiedAt?: (path: string) => string | undefined;
  /** Repo-relative paths git reports changed between base and end. */
  changed?: readonly string[];
  /** Include the agent's thinking in `why`, when the transcript kept it. */
  thinking?: boolean;
  /** Defaults to the first prompt's first line. */
  title?: string;
  /**
   * Paths whose bodies are never stored — only the fact that they changed.
   * Defaults to lockfiles.
   */
  omit?: (path: string) => boolean;
  /** Notes to carry over from an earlier capture, by step id. */
  notes?: Record<string, Note>;
  source?: string;
  /** Larger file bodies are not stored. Default 512 KiB. */
  maxFileBytes?: number;
  /** Command output beyond this is truncated. Default 4,000 characters. */
  maxOutputChars?: number;
}

/** The last step at or before `time`; -1 when every step is later. */
function lastStepBy(steps: readonly Step[], time: string): number | undefined {
  const t = Date.parse(time);
  if (Number.isNaN(t)) return undefined;
  let found = -1;
  steps.forEach((step, i) => {
    if (Date.parse(step.at) <= t) found = i;
  });
  return found;
}

function posix(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * A whole-file change as the smallest edit that makes it: the changed lines
 * as `oldString`, when they occur exactly once — or `undefined`, and the
 * change is stored as a write. Patches carry no strings of their own, and a
 * replay that stored every patched file whole would grow with file size.
 */
export function editBetween(
  before: string,
  after: string,
): { oldString: string; newString: string } | undefined {
  const hunks = diffHunks(before, after);
  const first = hunks[0];
  const last = hunks.at(-1);
  if (!first || !last) return undefined;
  const start = first.at === 0 ? 0 : before.lastIndexOf("\n", first.at - 1) + 1;
  const stop = before.indexOf("\n", last.at + last.remove.length);
  const end = stop < 0 ? before.length : stop + 1;
  const oldString = before.slice(start, end);
  if (!oldString || before.indexOf(oldString) !== before.lastIndexOf(oldString)) {
    return undefined;
  }
  return {
    oldString,
    newString: after.slice(start, end + after.length - before.length),
  };
}

/**
 * Content a replay records as changed but never stores: excluded paths
 * (lockfiles by default), anything over the size limit, and binary.
 */
export function unstorable(
  path: string,
  content: string | null | undefined,
  maxBytes: number,
  omit: (path: string) => boolean = isLockfile,
): boolean {
  return (
    typeof content === "string" &&
    (omit(path) || content.length > maxBytes || content.includes("\u0000"))
  );
}

/** First line, trimmed to a title's length. */
export function titleOf(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

export function capture(
  transcripts: readonly Transcript[],
  options: CaptureOptions,
): Replay {
  const main = transcripts[0];
  if (!main) throw new Error("capture needs at least one transcript");
  const root = posix(options.root).replace(/\/+$/, "");
  const maxFileBytes = options.maxFileBytes ?? 512 * 1024;
  const maxOutput = options.maxOutputChars ?? 4_000;

  const roots = [
    root,
    ...(options.aliases ?? []).map((alias) => posix(alias).replace(/\/+$/, "")),
  ];
  const relative = (file: unknown): string | undefined => {
    if (typeof file !== "string") return undefined;
    const path = posix(file);
    const at = roots.find((candidate) => path.startsWith(`${candidate}/`));
    if (!at) return undefined;
    const rel = path.slice(at.length + 1);
    return rel.startsWith(`${REPLAY_DIR}/`) ? undefined : rel;
  };
  const omit = options.omit ?? isLockfile;
  const tooBig = (path: string, content: string | null | undefined) =>
    unstorable(path, content, maxFileBytes, omit);

  // Subagents' transcripts interleave with the main one by time. The sort is
  // stable, so entries written in the same millisecond keep file order.
  const events = transcripts
    .flatMap((transcript) => transcript.events)
    .map((event, order) => ({ event, order, time: Date.parse(event.at) || 0 }))
    .sort((a, b) => a.time - b.time || a.order - b.order)
    .map(({ event }) => event);

  const steps: Step[] = [];
  const base: Record<string, string | null> = {};
  const state = new Map<string, string | null>();
  const lastTouch = new Map<string, number>();
  const pending = new Map<string, { parts: string[]; uuid?: string }>();
  let turn = -1;
  let title = "";

  const why = (agent: string): string | undefined => {
    const said = pending.get(agent);
    pending.delete(agent);
    const text = said ? redact(said.parts.join("\n\n")).trim() : "";
    return text || undefined;
  };

  const flush = (agent: string, at: string) => {
    const said = pending.get(agent);
    const text = why(agent);
    if (!text) return;
    steps.push({
      kind: "say",
      id: `say:${said?.uuid ?? steps.length}`,
      at,
      agent,
      turn,
      text,
    });
  };

  // Where each command ran. Kept out of the replay: it is an absolute path
  // on the capturing machine, and only attribution needs it.
  const cwds = new Map<string, string>();

  /** The command after step `after` that most likely changed `path`. */
  const causeOf = (path: string, after: number): number =>
    likeliestCause(
      steps.flatMap((step, index) =>
        index > after && step.kind === "command"
          ? [{ index, command: step.command, cwd: cwds.get(step.id) }]
          : [],
      ),
      path,
      root,
    );

  /** Insert a step mid-history, keeping the index bookkeeping true. */
  const insertAt = (index: number, step: Step) => {
    steps.splice(index, 0, step);
    for (const [path, touched] of lastTouch) {
      if (touched >= index) lastTouch.set(path, touched + 1);
    }
  };

  /**
   * Bring the replay's idea of `path` up to what a tool just saw, inserting
   * a drift step when the two disagree.
   */
  const observe = (
    path: string,
    seen: string | null | undefined,
    at: string,
    agent: string,
    id: string,
  ) => {
    if (!state.has(path)) {
      let initial = options.readBase?.(path);
      if (initial === undefined) initial = seen === undefined ? null : seen;
      base[path] = initial;
      state.set(path, initial);
    }
    if (seen === undefined || state.get(path) === seen) return;
    // Placed right after the command that most likely made the change, so
    // the file changes when it really did; at this call when none is named.
    const cause = causeOf(path, lastTouch.get(path) ?? -1);
    const anchor = cause >= 0 ? steps[cause]! : undefined;
    const drift: ExternalStep = {
      kind: "external",
      id: `drift:${id}`,
      at: anchor?.at ?? at,
      agent: anchor?.agent ?? agent,
      turn: anchor?.turn ?? turn,
      path,
      content: seen,
      reason: "drift",
    };
    if (anchor) drift.cause = anchor.id;
    const index = cause >= 0 ? cause + 1 : steps.length;
    insertAt(index, drift);
    lastTouch.set(path, index);
    state.set(path, seen);
  };

  const change = (step: Step & { path: string }, after: string | null) => {
    lastTouch.set(step.path, steps.length);
    steps.push(step);
    state.set(step.path, after);
  };

  for (const event of events) {
    const { agent, at } = event;
    if (event.type === "prompt") {
      flush(agent, at);
      if (agent === "main") turn++;
      if (!title && agent === "main") title = titleOf(event.text);
      steps.push({
        kind: "prompt",
        id: `prompt:${event.uuid ?? steps.length}`,
        at,
        agent,
        turn,
        text: redact(event.text),
      });
      continue;
    }
    if (event.type === "text" || event.type === "thinking") {
      if (event.type === "thinking" && !options.thinking) continue;
      const said = pending.get(agent) ?? { parts: [] };
      said.parts.push(event.text.trim());
      if (event.type === "text") said.uuid = event.uuid ?? said.uuid;
      pending.set(agent, said);
      continue;
    }

    // A failed edit did not happen, and its narration belongs to the retry —
    // but a failing command still ran, and is often the point.
    const commandsOnly = event.actions.every((action) => action.kind === "command");
    if (event.failed && !commandsOnly) continue;

    // One call can make several steps (a multi-edit, a patch over files).
    // Ids stay the call's own when it makes one, so notes survive recapture.
    const count = event.actions.reduce(
      (sum, action) =>
        sum +
        (action.kind === "patch"
          ? action.files.reduce(
              (n, file) => n + (file.op === "update" && file.moveTo ? 2 : 1),
              0,
            )
          : 1),
      0,
    );
    const reason = why(agent);
    let made = 0;
    const next = () => {
      const meta = {
        id: count > 1 ? `${event.id}.${made}` : event.id,
        at,
        agent,
        turn,
        ...(made === 0 && reason ? { why: reason } : {}),
      };
      made++;
      return meta;
    };
    const writeOrEdit = (path: string, before: string | null, after: string) => {
      const edit = before === null ? undefined : editBetween(before, after);
      change(
        edit
          ? { kind: "edit", ...next(), path, ...edit, replaceAll: false }
          : { kind: "write", ...next(), path, content: after },
        after,
      );
    };

    for (const action of event.actions) {
      if (action.kind === "command") {
        const output = truncate(redact(action.output ?? ""), maxOutput).trim();
        const step: CommandStep = {
          kind: "command",
          ...next(),
          command: redact(action.command),
        };
        if (action.description) step.description = action.description;
        if (output) step.output = output;
        if (event.failed) step.failed = true;
        if (event.cwd) cwds.set(step.id, posix(event.cwd));
        steps.push(step);
        // A file whose whole text is in the command (`cat > f <<'EOF'`) is
        // replayed as the write it is, right after the command — even when
        // the command failed later on, as `cat > f <<EOF … EOF && test` does.
        {
          const cwd = event.cwd ?? main.cwd;
          shellWrites(action.command, cwd ? posix(cwd) : undefined).forEach(
            (write, n) => {
              const path = relative(write.path);
              if (!path) return;
              observe(path, undefined, at, agent, event.id);
              const before = state.get(path) ?? null;
              const after = write.append
                ? `${before ?? ""}${write.content}`
                : write.content;
              if (after === before) return;
              const meta = { id: `${step.id}~${n}`, at, agent, turn, via: step.id };
              const edit = before === null ? undefined : editBetween(before, after);
              change(
                edit
                  ? { kind: "edit", ...meta, path, ...edit, replaceAll: false }
                  : { kind: "write", ...meta, path, content: after },
                after,
              );
            },
          );
        }
        continue;
      }
      if (action.kind === "patch") {
        for (const file of action.files) {
          const path = relative(file.path);
          if (!path) continue;
          observe(path, undefined, at, agent, event.id);
          if (file.op === "add") {
            change(
              { kind: "write", ...next(), path, content: file.content },
              file.content,
            );
          } else if (file.op === "delete") {
            change({ kind: "delete", ...next(), path }, null);
          } else {
            const before = state.get(path) ?? null;
            // Context not found: leave the file be, and let drift or the
            // end-state reconciliation show what the patch really did.
            const after =
              before === null ? undefined : applyChunks(before, file.chunks);
            if (after === undefined) continue;
            const target = file.moveTo ? relative(file.moveTo) : undefined;
            if (target && target !== path) {
              change({ kind: "delete", ...next(), path }, null);
              observe(target, undefined, at, agent, event.id);
              change({ kind: "write", ...next(), path: target, content: after }, after);
            } else {
              writeOrEdit(path, before, after);
            }
          }
        }
        continue;
      }
      const path = relative(action.path);
      if (!path) continue;
      if (action.kind === "edit") {
        observe(path, action.seen, at, agent, event.id);
        const before = state.get(path) ?? null;
        const after = applyEdit(
          before,
          action.oldString,
          action.newString,
          action.replaceAll,
        );
        change(
          {
            kind: "edit",
            ...next(),
            path,
            oldString: action.oldString,
            newString: action.newString,
            replaceAll: action.replaceAll,
          },
          after === undefined ? before : after,
        );
      } else if (action.kind === "write") {
        observe(path, action.seen, at, agent, event.id);
        change(
          { kind: "write", ...next(), path, content: action.content },
          action.content,
        );
      } else {
        observe(path, undefined, at, agent, event.id);
        change({ kind: "delete", ...next(), path }, null);
      }
    }
  }
  for (const agent of [...pending.keys()]) {
    flush(agent, main.endedAt ?? "");
  }

  // Reconciliation: whatever the recorded calls did not produce.
  if (options.readFinal) {
    const paths = new Set([
      ...state.keys(),
      ...(options.changed ?? []).filter((path) => !path.startsWith(`${REPLAY_DIR}/`)),
    ]);
    const inserts = new Map<number, ExternalStep[]>();
    for (const path of [...paths].sort()) {
      if (!state.has(path)) {
        const initial = options.readBase?.(path) ?? null;
        base[path] = initial;
        state.set(path, initial);
      }
      const final = options.readFinal(path);
      if (final === state.get(path)) continue;
      const touched = lastTouch.get(path) ?? -1;
      const cause = causeOf(path, touched);
      const modified = cause < 0 ? options.modifiedAt?.(path) : undefined;
      const bySlot = modified === undefined ? undefined : lastStepBy(steps, modified);
      // Never ahead of the last recorded edit to the file: the edit would
      // then apply to the final content rather than lead up to it.
      const slot =
        cause >= 0
          ? cause
          : bySlot === undefined
            ? steps.length - 1
            : Math.max(touched, bySlot);
      const timely = slot === bySlot && slot < steps.length - 1;
      const anchor = steps[slot] ?? steps[0];
      const step: ExternalStep = {
        kind: "external",
        id: `untracked:${path}`,
        at: timely ? modified! : (anchor?.at ?? main.endedAt ?? ""),
        agent: anchor?.agent ?? "main",
        turn: anchor?.turn ?? turn,
        path,
        content: final,
        reason: "untracked",
      };
      if (cause >= 0) step.cause = steps[cause]!.id;
      inserts.set(slot, [...(inserts.get(slot) ?? []), step]);
      state.set(path, final);
    }
    if (inserts.size > 0) {
      const merged: Step[] = inserts.get(-1) ?? [];
      steps.forEach((step, i) => {
        merged.push(step, ...(inserts.get(i) ?? []));
      });
      steps.splice(0, steps.length, ...merged);
    }
  }

  // Oversized bodies are tracked in full above (drift needs them) and only
  // left out of what is stored.
  const omitted: string[] = [];
  for (const [path, content] of Object.entries(base)) {
    if (tooBig(path, content)) {
      omitted.push(path);
      base[path] = "";
    }
  }
  for (const step of steps) {
    if (step.kind === "external" && tooBig(step.path, step.content)) {
      step.content = "";
      step.omitted = true;
    }
    if (step.kind === "write" && tooBig(step.path, step.content)) {
      step.content = "";
      if (!omitted.includes(step.path)) omitted.push(step.path);
    }
  }

  return {
    version: REPLAY_VERSION,
    id: main.sessionId ?? "session",
    title: options.title || title || "Untitled session",
    source: options.source ?? main.source,
    startedAt: main.startedAt ?? "",
    endedAt: main.endedAt ?? "",
    repo: options.repo,
    files: Object.fromEntries(
      Object.entries(base).sort(([a], [b]) => a.localeCompare(b)),
    ),
    omitted: omitted.sort(),
    steps,
    notes: options.notes ?? {},
  };
}
