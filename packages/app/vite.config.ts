import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { replayApi } from "./server/api.ts";

/**
 * The repositories whose `.replays/` the player lists: this one, plus any
 * named in `REPLAY_REPOS` (colon-separated, like `PATH`). Sessions from every
 * other repository on the machine are found from the agents' own logs.
 */
const here = fileURLToPath(new URL("../..", import.meta.url));
const repos = [
  here,
  ...(process.env.REPLAY_REPOS ?? "")
    .split(":")
    .filter(Boolean)
    .map((path) => resolve(path)),
].map((path) => path.replace(/\/+$/, ""));

export default defineConfig({
  plugins: [react(), tailwindcss(), replayApi({ repos: [...new Set(repos)] })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `geist` exports its `next/font` entries, not the font files.
      "geist-fonts": fileURLToPath(
        new URL("./node_modules/geist/dist/fonts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
  },
  build: {
    target: "es2023",
    sourcemap: true,
    // One chunk on purpose: `replay export` inlines it into a single file.
    chunkSizeWarningLimit: 1024,
  },
});
