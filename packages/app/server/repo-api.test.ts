// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createServer, request as httpRequest, type Server } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Replay } from "@agent-replay/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHandler, pageOf, type Page, type Project } from "./api.ts";
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
