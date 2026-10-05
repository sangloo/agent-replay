import type { Frame } from "@agent-replay/core";

export interface Lesson {
  frame?: Frame;
  number: number;
  frames: Frame[];
}

/** The steps of a course, by lesson. Steps before the first lesson are its preface. */
export function lessonsOf(frames: readonly Frame[]): Lesson[] {
  const lessons: Lesson[] = [];
  let current: Lesson = { number: 0, frames: [] };
  for (const frame of frames) {
    if (frame.step.kind === "lesson") {
      if (current.frame || current.frames.length) lessons.push(current);
      current = { frame, number: 0, frames: [] };
      continue;
    }
    current.frames.push(frame);
  }
  if (current.frame || current.frames.length) lessons.push(current);
  // The preface (steps before the first lesson) is not a numbered lesson.
  let number = 0;
  return lessons.map((lesson) => ({ ...lesson, number: lesson.frame ? ++number : 0 }));
}
