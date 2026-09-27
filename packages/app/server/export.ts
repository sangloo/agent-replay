/**
 * `replay export` — a replay as one HTML file: the built player with its
 * script, styles and fonts inlined, and the replay itself embedded. It opens
 * from disk, offline, in any browser — attach it to a pull request, send it,
 * archive it. Nothing is fetched and nothing is served.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Replay } from "@agent-replay/core";

/** The id the player looks for to run without its local service. */
export const EMBED_ID = "replay-data";

/**
 * The built player: `dist/` beside `server/` — in the repository and in the
 * published package alike.
 */
export function playerDist(): string {
  return resolve(dirname(dirname(fileURLToPath(import.meta.url))), "dist");
}

export function hasPlayer(dist = playerDist()): boolean {
  return existsSync(join(dist, "index.html"));
}

const MIME: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  svg: "image/svg+xml",
  png: "image/png",
};

// `<` in inline JSON or script must not end the element it sits in. The
// JSON is read back as text, never run, so `<` is all it needs escaped.
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const safeScript = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1");

function asset(dist: string, url: string): string {
  return join(dist, url.replace(/^\//, ""));
}

/** The player and `replay` in one document. */
export function exportHtml(replay: Replay, dist = playerDist()): string {
  if (!hasPlayer(dist)) {
    throw new Error("The player is not built — run `pnpm build` first.");
  }
  let html = readFileSync(join(dist, "index.html"), "utf8");

  html = html.replace(
    /<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
    (_, href: string) => {
      const css = readFileSync(asset(dist, href), "utf8").replace(
        /url\((\/assets\/[^)]+)\)/g,
        (whole, url: string) => {
          const path = asset(dist, url);
          if (!existsSync(path)) return whole;
          const type = MIME[url.split(".").pop() ?? ""] ?? "application/octet-stream";
          return `url(data:${type};base64,${readFileSync(path).toString("base64")})`;
        },
      );
      return `<style>${css.replace(/<\/(style)/gi, "<\\/$1")}</style>`;
    },
  );
  html = html.replace(/<link rel="modulepreload"[^>]*>/g, "");

  const scripts: string[] = [];
  html = html.replace(
    /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
    (_, src: string) => {
      scripts.push(readFileSync(asset(dist, src), "utf8"));
      return "";
    },
  );
  const title = replay.title.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"));
  // Replacements are functions throughout: a string replacement reads `$&`
  // and `$'` as patterns, and a minified bundle is full of both.
  html = html.replace(
    /<title>[^<]*<\/title>/,
    () => `<title>${title} · Replay</title>`,
  );
  const data = `<script type="application/json" id="${EMBED_ID}">${safeJson(replay)}</script>`;
  const code = scripts
    .map((script) => `<script type="module">${safeScript(script)}</script>`)
    .join("\n");
  // The data before the player, so it is there when the player starts.
  return html.replace("</body>", () => `${data}\n${code}\n</body>`);
}
