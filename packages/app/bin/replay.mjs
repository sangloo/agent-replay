#!/usr/bin/env node
// Plain JavaScript on purpose: it has to run — and say something useful — on
// any Node. Installed from npm, the CLI is one bundled file (`server/cli.mjs`)
// that needs Node 20; from a checkout it runs from source under Node's type
// stripping, which needs 22.18.
import { existsSync } from "node:fs";
import process from "node:process";

const bundled = new URL("../server/cli.mjs", import.meta.url);
const packaged = existsSync(bundled);
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const [needMajor, needMinor] = packaged ? [20, 0] : [22, 18];
if (major < needMajor || (major === needMajor && minor < needMinor)) {
  process.stderr.write(
    `replay: needs Node ${needMajor}.${needMinor} or newer (this is ${process.versions.node}).\n`,
  );
  process.exit(1);
}
try {
  await import(packaged ? bundled.href : "../server/cli.ts");
} catch (error) {
  // A mistyped flag, or anything else unexpected: one line, not a stack —
  // set REPLAY_DEBUG=1 for the stack.
  const code = error && typeof error === "object" ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (process.env.REPLAY_DEBUG) console.error(error);
  process.stderr.write(
    typeof code === "string" && code.startsWith("ERR_PARSE_ARGS")
      ? `replay: ${message}. See \`replay help\`.\n`
      : `replay: ${message}\n`,
  );
  process.exit(code?.startsWith?.("ERR_PARSE_ARGS") ? 2 : 1);
}
