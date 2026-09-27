/**
 * Reviewer-facing notes, attached to steps by id.
 *
 * The agent that made a change is the one that best knows why, and at the
 * end of its session it still has the whole context — so the notes are
 * written by it (see the `replay` skill), not reconstructed later by a model
 * reading the diff cold. They are merged in by step id, which survives a
 * re-capture of the same session.
 */

import type { Note, NoteLevel, Replay } from "./format.ts";

const LEVELS: readonly NoteLevel[] = ["info", "review", "risk"];

export interface Annotated {
  replay: Replay;
  /** Note ids that name no step in the replay. */
  unknown: string[];
}

/** Parse loosely-typed notes: `{ [stepId]: { text, level? } | string }`. */
export function readNotes(input: unknown): Record<string, Note> {
  const notes: Record<string, Note> = {};
  if (typeof input !== "object" || input === null) return notes;
  for (const [id, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim()) {
      notes[id] = { text: value.trim(), level: "info" };
    } else if (typeof value === "object" && value !== null) {
      const { text, level } = value as { text?: unknown; level?: unknown };
      if (typeof text !== "string" || !text.trim()) continue;
      notes[id] = {
        text: text.trim(),
        level: LEVELS.includes(level as NoteLevel) ? (level as NoteLevel) : "info",
      };
    }
  }
  return notes;
}

export function annotate(replay: Replay, notes: Record<string, Note>): Annotated {
  const ids = new Set(replay.steps.map((step) => step.id));
  const unknown = Object.keys(notes).filter((id) => !ids.has(id));
  const kept = Object.fromEntries(Object.entries(notes).filter(([id]) => ids.has(id)));
  return {
    replay: { ...replay, notes: { ...replay.notes, ...kept } },
    unknown,
  };
}
