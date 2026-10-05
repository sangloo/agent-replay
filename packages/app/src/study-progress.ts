import type { Replay, StudyContext } from "@agent-replay/core";

/**
 * Where a reader is in a replay, kept in this browser so closing the tab and
 * coming back later picks up there — and so every list can say how far along
 * each replay is without loading it.
 */
export interface StudyProgress {
  /** The step on screen when it was last left. */
  cursor: number;
  /** Done: reached the end, or marked by hand. */
  reviewed: boolean;
  updatedAt: number;
  /** The furthest step ever reached. Older saves lack it; `cursor` stands in. */
  furthest?: number;
  /** How many steps the replay had then, for "how far along" without the replay. */
  total?: number;
}

const enc = encodeURIComponent;

/** A replay's own progress: by its id, and the revision its steps arrive at. */
export const replayProgressKey = (replayId: string, revision: string) =>
  `replay:study:${enc(replayId)}:${enc(revision)}`;

export const lessonProgressKey = (
  courseId: string,
  lessonId: string,
  revision: string,
) => `replay:study:${enc(`${courseId}/${lessonId}`)}:${enc(revision)}`;

/** Where a session or a saved replay was left; not a lesson, so never "done". */
export const positionKey = (replayId: string) => `replay:position:${enc(replayId)}`;

export const revisionOf = (replay: Replay) =>
  replay.course?.rev ?? replay.repo.end ?? "";

/** The key a lesson's progress is read from: its place in a curriculum, or the replay. */
export const studyProgressKey = (replay: Replay, study?: StudyContext) =>
  study
    ? lessonProgressKey(study.curriculum.id, study.lessonId, study.curriculum.revision)
    : replayProgressKey(replay.id, revisionOf(replay));

/**
 * Every key a replay's progress is written to. A lesson in a curriculum is
 * also kept under the replay's own key, so the saved list and the Learn page
 * find it however the lesson was opened.
 */
export function progressKeys(replay: Replay, study?: StudyContext): string[] {
  if (replay.source !== "course") return [positionKey(replay.id)];
  const own = replayProgressKey(replay.id, revisionOf(replay));
  return study ? [studyProgressKey(replay, study), own] : [own];
}

export function readStudyProgress(key: string): StudyProgress | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return undefined;
    const p = value as StudyProgress;
    const count = (n: unknown) =>
      n === undefined || (Number.isSafeInteger(n) && (n as number) >= 0);
    return Number.isSafeInteger(p.cursor) &&
      p.cursor >= 0 &&
      typeof p.reviewed === "boolean" &&
      Number.isFinite(p.updatedAt) &&
      count(p.furthest) &&
      count(p.total)
      ? p
      : undefined;
  } catch {
    return undefined;
  }
}

export function saveStudyProgress(key: string, progress: StudyProgress) {
  try {
    localStorage.setItem(key, JSON.stringify(progress));
  } catch {
    /* Study remains usable without storage. */
  }
}

/** The furthest step reached, for old saves as well as new. */
export const furthestOf = (progress: StudyProgress) =>
  Math.max(progress.cursor, progress.furthest ?? 0);

/**
 * How far along, 0–1, when the step count is known. Done counts as all the
 * way: a lesson marked done by hand is finished, wherever its reader stopped.
 */
export function fractionOf(progress: StudyProgress | undefined, total?: number) {
  if (!progress) return 0;
  if (progress.reviewed) return 1;
  const steps = total ?? progress.total;
  if (!steps) return 0;
  return Math.min(1, furthestOf(progress) / steps);
}

/** A listed replay's progress, by what the listing knows of it. */
export function listedProgress(item: {
  agent: string;
  replayId?: string;
  revision?: string;
  id: string;
}): StudyProgress | undefined {
  const id = item.replayId ?? item.id;
  return readStudyProgress(
    item.agent === "course"
      ? replayProgressKey(id, item.revision ?? "")
      : positionKey(id),
  );
}

/** Course maps do not need replay bodies: find the newest revision saved for each lesson. */
export function courseProgress(
  courseId: string,
  revision: string,
): Record<string, StudyProgress> {
  const result: Record<string, StudyProgress> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (
        !key.startsWith("replay:study:") ||
        !key.endsWith(`:${encodeURIComponent(revision)}`)
      )
        continue;
      const identity = decodeURIComponent(
        key.slice("replay:study:".length).split(":")[0]!,
      );
      if (!identity.startsWith(`${courseId}/`)) continue;
      const id = identity.slice(courseId.length + 1),
        p = readStudyProgress(key);
      if (p && (!result[id] || p.updatedAt > result[id].updatedAt)) result[id] = p;
    }
  } catch {
    /* Unavailable or malformed storage is only a lost convenience. */
  }
  return result;
}
