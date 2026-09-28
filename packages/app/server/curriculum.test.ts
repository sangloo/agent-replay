// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { readStudyCourse, readCurriculumFile, CURRICULUM_FILE } from "./curriculum.ts";
const root = mkdtempSync(join(tmpdir(), "replay-curriculum-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
it("reports missing course replays without crashing or changing the replay listing", () => {
  expect(readStudyCourse(root)).toBeUndefined();
  mkdirSync(join(root, ".replays"));
  writeFileSync(
    join(root, CURRICULUM_FILE),
    JSON.stringify({
      version: 1,
      revision: "pin",
      id: "test",
      title: "Test",
      description: "Test",
      chapters: [
        {
          id: "first",
          title: "First",
          description: "Start",
          lessons: [
            {
              id: "01",
              title: "One",
              goal: "Learn",
              replay: "missing",
              prerequisites: [],
            },
          ],
        },
      ],
    }),
  );
  expect(readStudyCourse(root)?.unavailable).toEqual(["01"]);
});
it("rejects oversized or malformed manifests", () => {
  const file = join(root, "invalid");
  writeFileSync(file, "x".repeat(1024 * 1024 + 1));
  expect(() => readCurriculumFile(file)).toThrow(/exceeds/);
  writeFileSync(file, "{}");
  expect(() => readCurriculumFile(file)).toThrow(/version/);
});
