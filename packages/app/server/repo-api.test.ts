// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createServer, request as httpRequest, type Server } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Replay, StudyCatalog } from "@agent-replay/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createHandler,
  pageOf,
  type Page,
  type Project,
  type SavedListing,
} from "./api.ts";
import { idKey } from "./store.ts";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "replay-repo-api-")));
const repo = join(temp, "repo");
let base = "";
// Sealed off from the machine: no real agent logs, and the one file the
// tool writes outside a repository goes here, not into ~/.config.
process.env.CLAUDE_CONFIG_DIR = join(temp, "claude");
process.env.CODEX_HOME = join(temp, "codex");
process.env.XDG_CONFIG_HOME = join(temp, "config");
const key = () => idKey(repo);

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
    { encoding: "utf8" },
  ).trim();
}

function replay(id: string, title: string, source: string, startedAt: string): Replay {
  return {
    version: 1,
    id,
    title,
    source,
    startedAt,
    endedAt: startedAt,
    repo: { name: "repo", base, end: base, dirty: false, commits: [] },
    files: {},
    omitted: [],
    steps: [],
    notes: {},
  };
}

function get(
  port: number,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  return new Promise<{ status: number; body: { data?: unknown; detail?: string } }>(
    (resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path,
          method: options.method ?? "GET",
          headers: options.headers,
        },
        (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }),
          );
        },
      );
      req.on("error", reject);
      if (options.body !== undefined) req.write(JSON.stringify(options.body));
      req.end();
    },
  );
}

let server: Server;
let port = 0;

beforeAll(async () => {
  mkdirSync(join(repo, "src"), { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "README.md"), "# repo\n");
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "logo.bin"), Buffer.from([0, 1, 2, 3]));
  git("add", ".");
  git("commit", "-qm", "base");
  base = git("rev-parse", "HEAD");
  mkdirSync(join(repo, ".replays"));
  const saved = [
    replay("s1", "Fix the upload test", "claude-code", "2026-09-01T10:00:00Z"),
    replay("s2", "Add pagination", "codex", "2026-09-02T10:00:00Z"),
    replay("s3", "Fix pagination edge", "claude-code", "2026-09-03T10:00:00Z"),
  ];
  for (const item of saved) {
    writeFileSync(join(repo, ".replays", `${item.id}.json`), JSON.stringify(item));
  }

  const handler = createHandler({ repos: [repo] });
  server = createServer((req, res) => {
    req.url = req.url!.replace(/^\/api/, "");
    handler(req, res, () => {
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server.close();
  rmSync(temp, { recursive: true, force: true });
});

describe("the listings", () => {
  it("search every word, filter by agent, count what each filter would show", async () => {
    const { body } = await get(port, "/api/replays?q=fix&agent=claude-code");
    const page = body.data as Page<{ id: string; title: string }>;
    expect(page.items.map((item) => item.title)).toEqual([
      "Fix pagination edge",
      "Fix the upload test",
    ]);
    expect(page.total).toBe(2);
    expect(page.agents).toEqual({ "claude-code": 2 });
    expect(page.projects).toEqual({ [repo]: 2 });
  });

  it("cuts pages, newest first", async () => {
    const first = (await get(port, "/api/replays?limit=2")).body.data as Page<{
      id: string;
    }>;
    const second = (await get(port, "/api/replays?limit=2&offset=2")).body
      .data as Page<{ id: string }>;
    expect(first.total).toBe(3);
    expect(first.items.map((item) => item.id)).toEqual([`${key()}:s3`, `${key()}:s2`]);
    expect(second.items.map((item) => item.id)).toEqual([`${key()}:s1`]);
  });
});

describe("pageOf", () => {
  const items = [
    { agent: "a", name: "one", where: "x" },
    { agent: "b", name: "two", where: "x" },
    { agent: "a", name: "three", where: "y" },
  ];
  const page = (search: string) =>
    pageOf(
      items,
      new URLSearchParams(search),
      (item) => item.name,
      (item) => item.where,
    );

  it("counts agents under the project filter, and projects under the agent filter", () => {
    const filtered = page("agent=a&project=x");
    expect(filtered.items.map((item) => item.name)).toEqual(["one"]);
    expect(filtered.agents).toEqual({ a: 1, b: 1 });
    expect(filtered.projects).toEqual({ x: 1, y: 1 });
  });

  it("uses the default page when no limit is given", () => {
    expect(page("").limit).toBe(25);
    expect(page("limit=0").limit).toBe(1);
    expect(page("limit=500").limit).toBe(100);
  });
});

describe("the repository around a replay", () => {
  it("lists every file at the base commit", async () => {
    const { status, body } = await get(port, `/api/replays/${key()}:s1/tree`);
    expect(status).toBe(200);
    expect(body.data).toEqual({
      rev: base,
      paths: ["README.md", "logo.bin", "src/a.ts"],
    });
  });

  it("reads one, and says why when it cannot", async () => {
    const file = (path: string, rev = base) =>
      get(port, `/api/replays/${key()}:s1/file?${new URLSearchParams({ rev, path })}`);
    expect((await file("src/a.ts")).body.data).toEqual({
      path: "src/a.ts",
      content: "export const a = 1;\n",
    });
    expect((await file("logo.bin")).body.data).toMatchObject({ omitted: "binary" });
    expect((await file("missing.ts")).status).toBe(404);
  });

  it("never reads outside the repository or past a real commit", async () => {
    const file = (path: string, rev = base) =>
      get(port, `/api/replays/${key()}:s1/file?${new URLSearchParams({ rev, path })}`);
    expect((await file("../etc/passwd")).status).toBe(400);
    expect((await file("/etc/passwd")).status).toBe(400);
    expect((await file("src/../../x")).status).toBe(400);
    expect((await file("README.md", "HEAD")).status).toBe(400);
    expect((await get(port, `/api/replays/${key()}:nope/tree`)).status).toBe(404);
  });
});

describe("an image in the repository", () => {
  const image = (path: string, rev?: string) =>
    new Promise<{ status: number; type?: string; bytes: Buffer }>((resolve, reject) => {
      const query = new URLSearchParams(rev ? { path, rev } : { path });
      httpRequest(
        { host: "127.0.0.1", port, path: `/api/replays/${key()}:s1/image?${query}` },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              type: res.headers["content-type"],
              bytes: Buffer.concat(chunks),
            }),
          );
        },
      )
        .on("error", reject)
        .end();
    });

  it("is served as itself, from the working tree or a commit, and nothing else is", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    writeFileSync(join(repo, "shot.png"), png);
    symlinkSync("/etc/hosts", join(repo, "out.png"));
    try {
      const shown = await image("shot.png");
      expect(shown.status).toBe(200);
      expect(shown.type).toBe("image/png");
      expect(shown.bytes.equals(png)).toBe(true);
      // Never committed, so not at the base.
      expect((await image("shot.png", base)).status).toBe(404);
      expect((await image("README.md")).status).toBe(415);
      expect((await image("out.png")).status).toBe(400);
      expect((await image("../x.png")).status).toBe(400);
      expect((await image("shot.png", "HEAD")).status).toBe(400);
    } finally {
      rmSync(join(repo, "shot.png"));
      rmSync(join(repo, "out.png"));
    }
  });
});

describe("projects", () => {
  const write = { "x-request-id": "r1", "content-type": "application/json" };

  it("lists the repositories it was started for, with what is saved there", async () => {
    const projects = (await get(port, "/api/projects")).body.data as Project[];
    expect(projects.find((project) => project.root === repo)).toMatchObject({
      name: "repo",
      saved: 3,
      added: false,
    });
  });

  it("adds a folder by path, remembers it, and forgets it again", async () => {
    const folder = join(temp, "elsewhere");
    mkdirSync(folder, { recursive: true });
    const added = await get(port, "/api/projects", {
      method: "POST",
      body: { path: folder },
      headers: write,
    });
    expect(added.status).toBe(200);
    expect(added.body.data).toMatchObject({ root: folder, added: true });
    expect(
      readFileSync(join(temp, "config", "replay", "projects.json"), "utf8"),
    ).toContain(folder);
    const forgotten = await get(
      port,
      `/api/projects?${new URLSearchParams({ root: folder })}`,
      { method: "DELETE", headers: write },
    );
    expect(forgotten.status).toBe(200);
    const projects = (await get(port, "/api/projects")).body.data as Project[];
    expect(projects.some((project) => project.root === folder)).toBe(false);
  });

  it("refuses a folder that is not there, and a write not from the player", async () => {
    const missing = await get(port, "/api/projects", {
      method: "POST",
      body: { path: join(temp, "nope") },
      headers: write,
    });
    expect(missing.status).toBe(422);
    const forged = await get(port, "/api/projects", {
      method: "POST",
      body: { path: temp },
      headers: { "content-type": "application/json" },
    });
    expect(forged.status).toBe(403);
  });

  it("lists the folders in a folder, marking repositories", async () => {
    const { body } = await get(
      port,
      `/api/folders?${new URLSearchParams({ path: temp })}`,
    );
    const listing = body.data as {
      path: string;
      folders: { name: string; repo: boolean }[];
    };
    expect(listing.path).toBe(temp);
    expect(listing.folders.find((folder) => folder.name === "repo")?.repo).toBe(true);
  });
});

describe("a course kept in a folder nested in a project", () => {
  // As `replay course … --repo tutorials/backend` leaves one: its own
  // `.replays/` and map, in a folder of the repository.
  const outer = join(temp, "outer");
  const course = join(outer, "tutorials", "backend");
  const write = { "x-request-id": "r2", "content-type": "application/json" };
  const query = (params: Record<string, string>) => new URLSearchParams(params);
  let outerBase = "";

  beforeAll(() => {
    mkdirSync(join(outer, "src"), { recursive: true });
    execFileSync("git", ["init", "-q", outer]);
    writeFileSync(join(outer, "src", "b.ts"), "export const b = 2;\n");
    execFileSync("git", ["-C", outer, "add", "."]);
    execFileSync("git", [
      ...["-C", outer, "-c", "user.name=t", "-c", "user.email=t@t"],
      ...["commit", "-qm", "base"],
    ]);
    outerBase = execFileSync("git", ["-C", outer, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    mkdirSync(join(course, ".replays"), { recursive: true });
    const lesson = replay("lesson-one", "One", "course", "2026-09-04T10:00:00Z");
    lesson.repo = { ...lesson.repo, base: outerBase, end: outerBase };
    writeFileSync(join(course, ".replays", "lesson-one.json"), JSON.stringify(lesson));
    writeFileSync(
      join(course, ".replays", "curriculum.manifest"),
      JSON.stringify({
        version: 1,
        id: "outer",
        revision: outerBase,
        title: "Understand outer",
        description: "From nothing.",
        chapters: [
          {
            id: "first",
            title: "First",
            description: "Start.",
            lessons: [
              {
                id: "01",
                title: "One",
                goal: "Begin.",
                replay: "lesson-one",
                prerequisites: [],
              },
            ],
          },
        ],
      }),
    );
  });

  it("is found once the folder is opened, and listed under the repository", async () => {
    // Opened from inside the course's folder: kept as the repository's root.
    const added = await get(port, "/api/projects", {
      method: "POST",
      body: { path: course },
      headers: write,
    });
    expect(added.body.data).toMatchObject({ root: outer, saved: 1, added: true });

    const inProject = (await get(port, `/api/curricula?${query({ project: outer })}`))
      .body.data as StudyCatalog;
    expect(inProject.courses.map((c) => [c.key, c.curriculum.title])).toEqual([
      [idKey(course), "Understand outer"],
    ]);
    expect(inProject.courses[0]!.unavailable).toEqual([]);
    const everywhere = (await get(port, "/api/curricula")).body.data as StudyCatalog;
    expect(everywhere.courses.map((c) => c.key)).toContain(idKey(course));
    // Another project's courses are not this one's.
    const elsewhere = (await get(port, `/api/curricula?${query({ project: repo })}`))
      .body.data as StudyCatalog;
    expect(elsewhere.courses).toEqual([]);

    const lessons = (
      await get(port, `/api/replays?${query({ agent: "course", project: outer })}`)
    ).body.data as Page<SavedListing>;
    expect(lessons.items).toMatchObject([
      {
        id: `${idKey(course)}:lesson-one`,
        repo: "outer/tutorials/backend",
        project: outer,
      },
    ]);
  });

  it("opens a lesson from it with the repository's files, on a fresh start too", async () => {
    // A new service has listed nothing yet: the folder is found from its key.
    const fresh = createHandler({ repos: [] });
    const ask = async (url: string) => {
      let text = "";
      const response = {
        statusCode: 0,
        setHeader() {},
        end: (body: string) => (text = body),
      };
      await fresh(
        { method: "GET", url, headers: {} } as never,
        response as never,
        () => {},
      );
      return { status: response.statusCode, body: JSON.parse(text) };
    };
    const id = `${idKey(course)}:lesson-one`;
    expect((await ask(`/replays/${id}`)).status).toBe(200);
    const catalog = (await ask(`/curricula?${query({ key: idKey(course) })}`)).body
      .data as StudyCatalog;
    expect(catalog.courses.map((c) => c.curriculum.title)).toEqual([
      "Understand outer",
    ]);
    // Asked of the repository's root, not of the folder the course is in.
    expect((await ask(`/replays/${id}/tree`)).body.data).toEqual({
      rev: outerBase,
      paths: ["src/b.ts"],
    });
    const file = await ask(
      `/replays/${id}/file?${query({ rev: outerBase, path: "src/b.ts" })}`,
    );
    expect(file.body.data).toMatchObject({ content: "export const b = 2;\n" });
  });
});
