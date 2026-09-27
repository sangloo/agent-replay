/**
 * `replay open` — the player and its API from one small Node server, so the
 * tool runs from anywhere without Vite: the built player from `dist/`, the
 * same `/api` handler the dev server mounts, localhost only.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

import { createHandler } from "./api.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** `localhost`, `127.0.0.1` or `[::1]`, on our port. */
export function isLocalHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?$/i.exec(host);
  return Boolean(match) && (match![2] === undefined || Number(match![2]) === port);
}

export function serve(options: {
  dist: string;
  repos: string[];
  port: number;
}): Promise<string> {
  const api = createHandler({ repos: options.repos });
  const server = createServer((request, response) => {
    // DNS rebinding: a page on another origin that resolves its own name to
    // 127.0.0.1 reaches this server with its own Host. Only local names get
    // an answer — this serves every agent session on the machine.
    if (!isLocalHost(request.headers.host, options.port)) {
      response.statusCode = 403;
      response.end("Forbidden: replay only answers on localhost.");
      return;
    }
    let url: string;
    try {
      url = decodeURIComponent((request.url ?? "/").split("?")[0]!);
    } catch {
      response.statusCode = 400;
      response.end("Bad request.");
      return;
    }
    if (url.startsWith("/api/")) {
      request.url = request.url!.slice("/api".length);
      api(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
      return;
    }
    let file = join(options.dist, normalize(url));
    if (
      !file.startsWith(options.dist + sep) ||
      !existsSync(file) ||
      statSync(file).isDirectory()
    ) {
      file = join(options.dist, "index.html");
    }
    response.setHeader(
      "Content-Type",
      TYPES[extname(file)] ?? "application/octet-stream",
    );
    response.end(readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () =>
      resolve(`http://localhost:${options.port}`),
    );
  });
}
