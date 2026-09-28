import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Replay } from "@agent-replay/core";

import { EMBED_ID, exportHtml } from "./export.ts";

function fakeDist(): string {
  const dist = mkdtempSync(join(tmpdir(), "replay-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(
    join(dist, "index.html"),
    `<!doctype html><html><head><title>Replay</title>
<script type="module" crossorigin src="/assets/index.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index.css">
</head><body><div id="root"></div></body></html>`,
  );
  // `$'` and `$&` in the bundle, as a minifier leaves them.
  writeFileSync(
    join(dist, "assets/index.js"),
    'console.log("</script>", "$\'", "$&");',
  );
  writeFileSync(
    join(dist, "assets/index.css"),
    "@font-face{src:url(/assets/f.woff2)}body{color:red}",
  );
  writeFileSync(join(dist, "assets/f.woff2"), Buffer.from([1, 2, 3]));
  return dist;
}

describe("exportHtml", () => {
  it("inlines the player and embeds the replay, so the file stands alone", () => {
    const replay = { title: "Fix <b> & more", steps: [], text: "</script><x>" };
    const html = exportHtml(replay as unknown as Replay, fakeDist());
    expect(html).not.toMatch(/src="\/assets|href="\/assets|url\(\/assets/);
    expect(html).toContain("url(data:font/woff2;base64,AQID)");
    expect(html).toContain("<title>Fix &lt;b> &amp; more · Replay</title>");
    // Neither the data nor the code can close their script element early.
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).toContain(`"$'", "$&"`);
    expect(html.match(/<html>/g)).toHaveLength(1);
    const data = html.match(
      new RegExp(`<script type="application/json" id="${EMBED_ID}">(.*?)</script>`),
    )?.[1];
    expect(JSON.parse(data!)).toEqual(replay);
  });
});

it("embeds a companion course map and lesson navigation without server dependencies", async () => {
  const { parseCurriculum } = await import("@agent-replay/core");
  const { exportCurriculumHtml } = await import("./export.ts");
  const curriculum = parseCurriculum({
    version: 1,
    id: "course",
    revision: "edition-two",
    title: "Read </script> safely",
    description: "A shared course",
    libraryFile: "index.html",
    chapters: [
      {
        id: "start",
        title: "Start",
        description: "One lesson",
        lessons: [
          {
            id: "01",
            title: "One",
            goal: "Learn",
            replay: "one",
            prerequisites: [],
            exportFile: "one.html",
          },
        ],
      },
    ],
  });
  const dist = fakeDist();
  const library = exportCurriculumHtml(curriculum, "exports/published/", dist);
  expect(library).not.toMatch(/src="\/assets|href="\/assets|url\(\/assets/);
  const data = library.match(/id="curriculum-library">(.*?)<\/script>/)?.[1];
  expect(JSON.parse(data!)).toEqual({ curriculum, exportBase: "exports/published/" });
  expect(library.match(/<\/script>/g)).toHaveLength(2);
  for (const unsafe of ["../", "https://host/", "/absolute/", "folder\\path/"])
    expect(() => exportCurriculumHtml(curriculum, unsafe, dist)).toThrow();
  const lesson = exportHtml({ title: "One" } as Replay, dist, {
    curriculum,
    lessonId: "01",
    key: "local-root-private",
    unavailable: ["01"],
  });
  const context = JSON.parse(lesson.match(/id="curriculum-data">(.*?)<\/script>/)![1]!);
  expect(context).toEqual({ curriculum, lessonId: "01" });
  expect(lesson).not.toContain("local-root-private");
});
