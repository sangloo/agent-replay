import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  parseCurriculum,
  curriculumLessons,
  type StudyCourse,
} from "@agent-replay/core";
import { idKey, listSaved } from "./store.ts";

/** A non-replay sidecar, deliberately outside the *.json replay listing. */
export const CURRICULUM_FILE = ".replays/curriculum.manifest";

export function readCurriculumFile(file: string) {
  if (statSync(file).size > 1024 * 1024) throw new Error("Curriculum exceeds 1 MiB.");
  return parseCurriculum(JSON.parse(readFileSync(file, "utf8")));
}

export function readStudyCourse(root: string): StudyCourse | undefined {
  let curriculum;
  try {
    curriculum = readCurriculumFile(join(root, CURRICULUM_FILE));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const saved = new Set(
    listSaved(root)
      .filter((item) => item.agent === "course")
      .map((item) => item.name),
  );
  return {
    key: idKey(root),
    curriculum,
    unavailable: curriculumLessons(curriculum)
      .filter((lesson) => !saved.has(lesson.replay))
      .map((lesson) => lesson.id),
  };
}
