/**
 * Applying one step to one file — the only definition of what a step does,
 * shared by capture (to track state and notice drift) and by the player (to
 * rebuild it). Two definitions would disagree on the first edit whose
 * `old_string` is ambiguous, and the replay would show a file that never
 * existed.
 */

import { diffHunks, type Hunk } from "./diff.ts";
import type { ChangeStep, EditStep } from "./format.ts";

/**
 * The Edit tool's semantics: `old_string` is unique unless `replace_all`, and
 * an empty `old_string` creates a file. `undefined` when it cannot apply,
 * which after capture's drift correction means the transcript itself was
 * inconsistent.
 */
export function applyEdit(
  content: string | null,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string | undefined {
  if (oldString === "") {
    return content === null || content === "" ? newString : undefined;
  }
  if (content === null) return undefined;
  const at = content.indexOf(oldString);
  if (at < 0) return undefined;
  if (replaceAll) return content.split(oldString).join(newString);
  return content.slice(0, at) + newString + content.slice(at + oldString.length);
}

/** A file's content after a change step, or `undefined` if it cannot apply. */
export function applyStep(
  content: string | null,
  step: ChangeStep,
): string | null | undefined {
  switch (step.kind) {
    case "edit":
      return applyEdit(content, step.oldString, step.newString, step.replaceAll);
    case "write":
      return step.content;
    case "delete":
      return null;
    case "external":
      return step.content;
  }
}

/**
 * Where an edit lands, as hunks in the before text. Computed from the edit's
 * own strings rather than by diffing the whole file, so the hunk is exactly
 * the region the agent addressed.
 */
export function editHunks(before: string | null, step: EditStep): Hunk[] {
  if (step.oldString === "") {
    return [{ at: 0, remove: before ?? "", insert: step.newString }];
  }
  if (before === null) return [];
  const inner = diffHunks(step.oldString, step.newString);
  const hunks: Hunk[] = [];
  let from = 0;
  for (;;) {
    const at = before.indexOf(step.oldString, from);
    if (at < 0) break;
    for (const hunk of inner) hunks.push({ ...hunk, at: hunk.at + at });
    if (!step.replaceAll) break;
    from = at + step.oldString.length;
  }
  return hunks;
}

/** The hunks a change step makes to `before`. */
export function stepHunks(before: string | null, step: ChangeStep): Hunk[] {
  if (step.kind === "edit") return editHunks(before, step);
  if (step.kind === "delete") return diffHunks(before ?? "", "");
  return diffHunks(before ?? "", step.content ?? "");
}
