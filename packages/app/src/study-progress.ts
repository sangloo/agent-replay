import type { Replay, StudyContext } from "@agent-replay/core";

export interface StudyProgress {
  cursor: number;
  reviewed: boolean;
  updatedAt: number;
}
export const studyProgressKey = (replay: Replay, study?: StudyContext) =>
  `replay:study:${encodeURIComponent(study ? `${study.curriculum.id}/${study.lessonId}` : replay.id)}:${encodeURIComponent(study?.curriculum.revision ?? replay.course?.rev ?? replay.repo.end ?? "")}`;
export const lessonProgressKey = (
  courseId: string,
  lessonId: string,
  revision: string,
) =>
  `replay:study:${encodeURIComponent(`${courseId}/${lessonId}`)}:${encodeURIComponent(revision)}`;

export function readStudyProgress(key: string): StudyProgress | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return undefined;
    const p = value as StudyProgress;
    return Number.isSafeInteger(p.cursor) &&
      p.cursor >= 0 &&
      typeof p.reviewed === "boolean" &&
      Number.isFinite(p.updatedAt)
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
