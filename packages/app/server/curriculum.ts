import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseCurriculum,
  curriculumLessons,
  type StudyCourse,
} from "@agent-replay/core";
import { idKey } from "./store.ts";

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
  // A map is an index, not a validation pass over every replay body.
  // Missing files are marked here; a selected replay is read when opened.
  let names: string[] = [];
  try {
    names = readdirSync(join(root, ".replays"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const saved = new Set(names);
  return {
    key: idKey(root),
    curriculum,
    unavailable: curriculumLessons(curriculum)
      .filter((lesson) => !saved.has(lesson.replay))
      .map((lesson) => lesson.id),
  };
}
