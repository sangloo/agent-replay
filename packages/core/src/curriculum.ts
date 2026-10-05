/** Optional course-wide organization. Existing replay files stay unchanged. */
export interface CurriculumLesson {
  id: string;
  title: string;
  goal: string;
  /** A saved replay basename, without .json. */
  replay: string;
  prerequisites: string[];
  referenceOnly?: boolean;
  /** Companion export basename; links are only offered when explicitly supplied. */
  exportFile?: string;
}

export interface CurriculumChapter {
  id: string;
  title: string;
  description: string;
  lessons: CurriculumLesson[];
}

export interface Curriculum {
  version: 1;
  revision: string;
  id: string;
  title: string;
  description: string;
  /** Optional companion course-map HTML basename. */
  libraryFile?: string;
  chapters: CurriculumChapter[];
}

export interface StudyCourse {
  key: string;
  curriculum: Curriculum;
  unavailable: string[];
}

export interface StudyCatalog {
  courses: StudyCourse[];
  problems: { project: string; message: string }[];
}

export interface StudyContext {
  curriculum: Curriculum;
  lessonId: string;
  /** Absent for companion HTML exports. */
  key?: string;
  unavailable?: string[];
}

export const curriculumLessons = (curriculum: Curriculum) =>
  curriculum.chapters.flatMap((chapter) => chapter.lessons);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a curriculum object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`Invalid curriculum ${field}.`);
  return value;
}

function id(value: unknown): string {
  const result = text(value, "id", 120);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new Error("Invalid curriculum id.");
  return result;
}

/** Reject ambiguous order, unsafe filenames and prerequisites that cannot precede a lesson. */
export function parseCurriculum(value: unknown): Curriculum {
  const input = record(value);
  if (input.version !== 1) throw new Error("Unsupported curriculum version.");
  if (
    !Array.isArray(input.chapters) ||
    !input.chapters.length ||
    input.chapters.length > 100
  )
    throw new Error("A curriculum needs 1–100 chapters.");
  const libraryFile = input.libraryFile;
  if (
    libraryFile !== undefined &&
    (typeof libraryFile !== "string" ||
      libraryFile.length > 220 ||
      !/^[\w-][\w.-]*\.html$/.test(libraryFile))
  )
    throw new Error("Library filename must be an HTML basename.");
  const chapters = new Set<string>();
  const lessons = new Set<string>();
  const replays = new Set<string>();
  const exports = new Set<string>(typeof libraryFile === "string" ? [libraryFile] : []);
  return {
    version: 1,
    ...(typeof libraryFile === "string" ? { libraryFile } : {}),
    revision: text(input.revision, "revision", 120),
    id: id(input.id),
    title: text(input.title, "title", 300),
    description: text(input.description, "description"),
    chapters: input.chapters.map((raw) => {
      const chapter = record(raw);
      const chapterId = id(chapter.id);
      if (chapters.has(chapterId)) throw new Error("Duplicate chapter id.");
      chapters.add(chapterId);
      if (!Array.isArray(chapter.lessons) || !chapter.lessons.length)
        throw new Error("Every chapter needs lessons.");
      return {
        id: chapterId,
        title: text(chapter.title, "chapter title", 300),
        description: text(chapter.description, "chapter description"),
        lessons: chapter.lessons.map((rawLesson) => {
          const lesson = record(rawLesson);
          const lessonId = id(lesson.id);
          const replay = text(lesson.replay, "replay", 220);
          if (
            !/^[\w-][\w.-]*$/.test(replay) ||
            replay === ".." ||
            replay.endsWith(".json")
          )
            throw new Error("Replay must be a basename without .json.");
          if (lessons.has(lessonId) || replays.has(replay))
            throw new Error("Duplicate lesson or replay.");
          if (
            !Array.isArray(lesson.prerequisites) ||
            lesson.prerequisites.some((p) => typeof p !== "string" || !lessons.has(p))
          )
            throw new Error(`Prerequisites must precede lesson ${lessonId}.`);
          if (new Set(lesson.prerequisites).size !== lesson.prerequisites.length)
            throw new Error("Duplicate prerequisite.");
          let exportFile: string | undefined;
          if (lesson.exportFile !== undefined) {
            exportFile = text(lesson.exportFile, "export filename", 220);
            if (!/^[\w-][\w.-]*\.html$/.test(exportFile) || exports.has(exportFile))
              throw new Error("Export filenames must be unique HTML basenames.");
            exports.add(exportFile);
          }
          if (
            lesson.referenceOnly !== undefined &&
            typeof lesson.referenceOnly !== "boolean"
          )
            throw new Error("referenceOnly must be a boolean.");
          lessons.add(lessonId);
          replays.add(replay);
          if (lessons.size > 2000)
            throw new Error("A curriculum may have at most 2000 lessons.");
          return {
            id: lessonId,
            title: text(lesson.title, "lesson title", 300),
            goal: text(lesson.goal, "lesson goal"),
            replay,
            prerequisites: lesson.prerequisites as string[],
            ...(exportFile ? { exportFile } : {}),
            ...(lesson.referenceOnly === true ? { referenceOnly: true } : {}),
          };
        }),
      };
    }),
  };
}

export function studyHref(
  context: StudyContext,
  lesson: CurriculumLesson,
): string | undefined {
  if (context.unavailable?.includes(lesson.id)) return undefined;
  return context.key
    ? `#/replay/${encodeURIComponent(`${context.key}:${lesson.replay}`)}`
    : lesson.exportFile;
}
