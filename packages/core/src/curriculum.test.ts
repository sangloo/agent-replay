import { describe, expect, it } from "vitest";
import { parseCurriculum, studyHref } from "./curriculum.ts";
const manifest = () => ({
  version: 1,
  revision: "pin",
  id: "demo",
  title: "Demo",
  description: "Learn in order.",
  chapters: [
    {
      id: "one",
      title: "Foundation",
      description: "Start here.",
      lessons: [
        {
          id: "01",
          title: "First",
          goal: "Understand the first rule.",
          replay: "first",
          prerequisites: [] as string[],
          exportFile: "first.html",
        },
        {
          id: "02",
          title: "Second",
          goal: "Use the first rule.",
          replay: "second",
          prerequisites: ["01"],
        },
      ],
    },
  ],
});
describe("curriculum boundaries", () => {
  it("keeps explicit order and builds local or companion links", () => {
    const c = parseCurriculum(manifest());
    expect(c.chapters[0]!.lessons.map((x) => x.id)).toEqual(["01", "02"]);
    expect(
      studyHref(
        { curriculum: c, lessonId: "01", key: "abc" },
        c.chapters[0]!.lessons[0]!,
      ),
    ).toBe("#/replay/abc%3Afirst");
    expect(
      studyHref({ curriculum: c, lessonId: "01" }, c.chapters[0]!.lessons[0]!),
    ).toBe("first.html");
    expect(
      studyHref(
        { curriculum: c, lessonId: "01", key: "abc", unavailable: ["01"] },
        c.chapters[0]!.lessons[0]!,
      ),
    ).toBeUndefined();
  });
  it("rejects cycles, later prerequisites, duplicate IDs and traversal", () => {
    for (const edit of [
      (m: ReturnType<typeof manifest>) =>
        m.chapters[0]!.lessons[0]!.prerequisites.push("02"),
      (m: ReturnType<typeof manifest>) => (m.chapters[0]!.lessons[1]!.id = "01"),
      (m: ReturnType<typeof manifest>) =>
        (m.chapters[0]!.lessons[0]!.replay = "../private"),
      (m: ReturnType<typeof manifest>) =>
        (m.chapters[0]!.lessons[0]!.exportFile = "https://evil.test/a.html"),
    ]) {
      const m = manifest();
      edit(m);
      expect(() => parseCurriculum(m)).toThrow();
    }
  });
});

it("validates the companion library basename and prevents a lesson from overwriting it", () => {
  expect(
    parseCurriculum({ ...manifest(), libraryFile: "index.html" }).libraryFile,
  ).toBe("index.html");
  for (const libraryFile of [
    "../index.html",
    "https://example.test/index.html",
    "first.html",
    42,
  ])
    expect(() => parseCurriculum({ ...manifest(), libraryFile })).toThrow();
  const withExtension = manifest();
  withExtension.chapters[0]!.lessons[0]!.replay = "first.json";
  expect(() => parseCurriculum(withExtension)).toThrow();
});
