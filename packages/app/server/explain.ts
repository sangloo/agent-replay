/**
 * `replay explain` — a small model's notes on a replay, for the parts nobody
 * annotated: what each commit (or each prompt of a session) did, and, where
 * a replay introduces many files at once, a tour — where to start reading,
 * which functions carry the weight.
 *
 * The notes are written into the replay like any reviewer's, as `info`
 * (or `review`, when the model thinks a change deserves a second look), and
 * never overwrite a note someone already wrote. It spends API credit, so it
 * only ever runs when asked, and says how much it sent.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { annotate, play, type Frame, type Note, type Replay } from "@agent-replay/core";

export const DEFAULT_MODEL = "claude-haiku-4-5";

/** The part of the SDK client explain uses — so a test can hand in a fake. */
export interface MessagesClient {
  messages: Pick<Anthropic["messages"], "create">;
}

interface Group {
  head: Frame;
  frames: Frame[];
  /** Many files arriving at once: ask for a tour. */
  introduces: boolean;
}

/** Commits (history) or prompts (sessions) and the changes that follow each. */
export function groups(replay: Replay): Group[] {
  const playback = play(replay);
  const out: Group[] = [];
  for (const frame of playback.frames) {
    const { step } = frame;
    if (step.kind === "commit" || (step.kind === "prompt" && step.agent === "main")) {
      out.push({ head: frame, frames: [], introduces: false });
    } else if (frame.change && out.length) {
      out.at(-1)!.frames.push(frame);
    }
  }
  for (const group of out) {
    group.introduces =
      group.frames.length >= 5 && group.frames.every((f) => f.change?.before === null);
  }
  return out.filter((group) => group.frames.length > 0);
}

const MAX_PER_FILE = 3_000;
const MAX_PER_GROUP = 60_000;

function clip(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n… (${text.length - max} more characters)`;
}

/** What the model reads about one change: the new file, or the hunks. */
function describeChange(frame: Frame): string {
  const change = frame.change!;
  const header = `### step ${frame.step.id} — ${change.path} (+${change.added} −${change.removed})`;
  if (change.after === null) return `${header}\n(deleted)`;
  if (change.before === null) return `${header}\n${clip(change.after, MAX_PER_FILE)}`;
  const hunks = change.hunks
    .map((hunk) =>
      [
        ...hunk.remove
          .split("\n")
          .filter(Boolean)
          .map((line) => `- ${line}`),
        ...hunk.insert
          .split("\n")
          .filter(Boolean)
          .map((line) => `+ ${line}`),
      ].join("\n"),
    )
    .join("\n…\n");
  return `${header}\n${clip(hunks, MAX_PER_FILE)}`;
}

export function promptFor(replay: Replay, group: Group): string {
  const { step } = group.head;
  const intro =
    step.kind === "commit"
      ? `Commit ${step.sha.slice(0, 7)}: ${step.subject}${step.body ? `\n\n${step.body}` : ""}`
      : step.kind === "prompt"
        ? `An agent was asked:\n${step.text}`
        : "";
  let body = "";
  let shown = 0;
  for (const frame of group.frames) {
    const next = describeChange(frame);
    if (body.length + next.length > MAX_PER_GROUP) {
      body += `(${group.frames.length - shown} more files not shown)\n`;
      break;
    }
    body += `${next}\n\n`;
    shown++;
  }
  const task = group.introduces
    ? `These files are being introduced to someone reading the repository "${replay.repo.name}" for the first time, in this order. For the head step "${step.id}", write a short tour: which one or two files to read first and why, and the core functions or types everything else leans on. Then, for the files that matter most (at most 12), one sentence each on what the file is for.`
    : `For the head step "${step.id}", write one or two sentences on what this ${step.kind === "commit" ? "commit" : "turn"} changed and why it matters. Then note only the individual steps a reviewer should not skim (at most 5): a subtle behaviour change, a risk, a non-obvious decision. Most steps need no note.`;
  return `${intro}\n\n${body}\n${task}\n\nUse the step ids exactly as given. Plain sentences, no markdown headings. Level "review" only for something a reviewer should check; otherwise "info".`;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["notes"],
  properties: {
    notes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "level", "text"],
        properties: {
          id: { type: "string" },
          level: { type: "string", enum: ["info", "review"] },
          text: { type: "string" },
        },
      },
    },
  },
};

export interface Explained {
  replay: Replay;
  added: number;
  requests: number;
  /** Requests that failed; their groups got no notes. */
  failed: number;
  inputTokens: number;
  outputTokens: number;
}

export async function explain(
  replay: Replay,
  client: MessagesClient,
  options: { model?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<Explained> {
  const todo = groups(replay);
  const notes: Record<string, Note> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let done = 0;

  // A few at a time: fast, without tripping a rate limit.
  const queue = [...todo];
  const failures: unknown[] = [];
  const work = async () => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      try {
        const response = await client.messages.create({
          model: options.model ?? DEFAULT_MODEL,
          max_tokens: 4_000,
          system:
            "You annotate replays of how code was written, for a person reviewing or learning it. Be concrete and brief; name files and functions; never restate the diff.",
          messages: [{ role: "user", content: promptFor(replay, group) }],
          output_config: { format: { type: "json_schema", schema: SCHEMA } },
        });
        inputTokens += response.usage.input_tokens;
        outputTokens += response.usage.output_tokens;
        const text = response.content.find((block) => block.type === "text");
        if (response.stop_reason !== "refusal" && text?.type === "text") {
          try {
            const parsed = JSON.parse(text.text) as {
              notes?: { id: string; level: string; text: string }[];
            };
            for (const note of parsed.notes ?? []) {
              if (replay.notes[note.id] || !note.text.trim()) continue;
              notes[note.id] = {
                text: note.text.trim(),
                level: note.level === "review" ? "review" : "info",
              };
            }
          } catch {
            // A malformed answer costs one group's notes, not the run.
          }
        }
      } catch (error) {
        // One failed request costs its group, not the notes already paid for.
        failures.push(error);
      }
      options.onProgress?.(++done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, todo.length) }, work));
  if (todo.length > 0 && failures.length === todo.length) throw failures[0];

  const { replay: annotated } = annotate(replay, notes);
  return {
    replay: annotated,
    added: Object.keys(annotated.notes).length - Object.keys(replay.notes).length,
    requests: todo.length,
    failed: failures.length,
    inputTokens,
    outputTokens,
  };
}
