#!/usr/bin/env node
/**
 * `pnpm package` — the tool as one self-contained npm package, so anyone can
 * run it without this repository:
 *
 *   npx <name>            # the player, on the sessions of the repo you are in
 *   npm i -g <name>       # or keep `replay` on the PATH
 *
 * Two builds into `.package/`: the player, prebuilt (`dist/`), and the CLI
 * with every dependency — the core, the Anthropic SDK — inlined into one
 * ES module (`server/cli.mjs`) that needs nothing but Node 20. No install
 * step, no dependencies to resolve, so `npx` starts in about a second.
 *
 * The package's name and version come from `publish.json`; `npm pack` and
 * `npm publish` run from `.package/`.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import process from "node:process";

import { build } from "vite";

const app = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(app, ".package");
const publish = JSON.parse(readFileSync(join(app, "publish.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. The player, as static files.
await build({
  root: app,
  configFile: join(app, "vite.config.ts"),
  logLevel: "warn",
  // No source maps: they would triple the download for a debugging aid the
  // package's users have no source to map to.
  build: { outDir: join(out, "dist"), emptyOutDir: true, sourcemap: false },
});

// 2. The CLI and the local service, as one file.
await build({
  root: app,
  configFile: false,
  logLevel: "warn",
  build: {
    ssr: join(app, "server/cli.ts"),
    outDir: join(out, "server"),
    emptyOutDir: true,
    target: "node20",
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: { format: "es", entryFileNames: "cli.mjs", codeSplitting: false },
    },
  },
  ssr: { target: "node", noExternal: true },
});

// 3. The launcher, the manifest, the readme and the licence.
mkdirSync(join(out, "bin"));
cpSync(join(app, "bin/replay.mjs"), join(out, "bin/replay.mjs"));
cpSync(join(app, "publish-readme.md"), join(out, "README.md"));
cpSync(join(app, "../../LICENSE"), join(out, "LICENSE"));
writeFileSync(
  join(out, "package.json"),
  `${JSON.stringify(
    {
      name: publish.name,
      version: publish.version,
      description: publish.description,
      type: "module",
      bin: { replay: "bin/replay.mjs", [publish.name]: "bin/replay.mjs" },
      files: ["bin", "server", "dist", "README.md", "LICENSE"],
      engines: { node: ">=20" },
      keywords: publish.keywords,
      license: publish.license,
      ...(publish.repository ? { repository: publish.repository } : {}),
      ...(publish.homepage ? { homepage: publish.homepage } : {}),
      ...(publish.bugs ? { bugs: publish.bugs } : {}),
    },
    null,
    2,
  )}\n`,
);

const tarball = execFileSync("npm", ["pack", "--silent"], {
  cwd: out,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .at(-1);
process.stdout.write(
  `Packaged ${publish.name}@${publish.version} → .package/${tarball}\n`,
);
