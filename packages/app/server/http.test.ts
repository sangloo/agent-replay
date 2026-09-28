// @vitest-environment node
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createHandler } from "./api.ts";
import { findSession } from "./sessions.ts";
import { isLocalHost, serve } from "./serve.ts";

// HTTP behavior must not depend on how many transcripts or projects happen
// to be present in the developer's home directory.
vi.mock(import("./sessions.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  listSessions: () => [],
  findSession: vi.fn(() => undefined),
}));
vi.mock(import("./projects.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  readAdded: () => [],
}));

describe("isLocalHost", () => {
  it("answers localhost on our port only", () => {
    expect(isLocalHost("localhost:5180", 5180)).toBe(true);
    expect(isLocalHost("127.0.0.1:5180", 5180)).toBe(true);
    expect(isLocalHost("[::1]:5180", 5180)).toBe(true);
    expect(isLocalHost("evil.example:5180", 5180)).toBe(false);
    expect(isLocalHost("localhost:9999", 5180)).toBe(false);
    expect(isLocalHost(undefined, 5180)).toBe(false);
  });
});

function call(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
) {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("the API handler", () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    const handler = createHandler({ repos: [] });
    server = createServer((req, res) => {
      req.url = req.url!.replace(/^\/api/, "");
      handler(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server.close());

  it("answers a malformed URL with 400 instead of dying", async () => {
    expect(await call(port, "/api/sessions/%E0")).toBe(400);
    expect(await call(port, "/api/replays")).toBe(200);
  });

  it("refuses writes that do not come from the player", async () => {
    expect(await call(port, "/api/sessions/x/save", { method: "POST" })).toBe(403);
    expect(
      await call(port, "/api/sessions/x/save", {
        method: "POST",
        headers: { "x-request-id": "r1", origin: "https://evil.example" },
      }),
    ).toBe(403);
  });

  it("looks sessions up by exact id, never by file path", async () => {
    expect(await call(port, "/api/sessions/package.json")).toBe(404);
    expect(findSession).toHaveBeenCalledWith("package.json", undefined, {
      exact: true,
    });
  });
});

describe("replay open's server", () => {
  const dist = mkdtempSync(join(tmpdir(), "replay-dist-"));
  const port = 5199;
  beforeAll(async () => {
    writeFileSync(join(dist, "index.html"), "<!doctype html>");
    await serve({ dist, repos: [], port });
  });
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it("refuses another Host — DNS rebinding", async () => {
    expect(
      await call(port, "/api/sessions", { headers: { host: "evil.example" } }),
    ).toBe(403);
    expect(await call(port, "/", { headers: { host: `localhost:${port}` } })).toBe(200);
  });

  it("survives a malformed URL", async () => {
    expect(await call(port, "/%E0", { headers: { host: `localhost:${port}` } })).toBe(
      400,
    );
    expect(await call(port, "/", { headers: { host: `localhost:${port}` } })).toBe(200);
  });
});
