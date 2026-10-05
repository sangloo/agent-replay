// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  openSync,
  closeSync,
  ftruncateSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ignored, readBlobs, readFilesAt, readWorking } from "./git.ts";

it("bulk snapshot and ignore checks preserve tracked, missing, Unicode and binary semantics", () => {
  const root = mkdtempSync(join(tmpdir(), "replay-batch-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  try {
    git("init", "-q");
    writeFileSync(join(root, ".gitignore"), "*.secret\n");
    writeFileSync(join(root, "tracked.secret"), "tracked\n");
    writeFileSync(join(root, "space é.ts"), "source\n");
    writeFileSync(join(root, "binary"), Buffer.from([0, 1, 2]));
    git("add", "-f", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    writeFileSync(join(root, "private.secret"), "private\n");
    const rev = git("rev-parse", "HEAD"),
      paths = ["tracked.secret", "private.secret", "space é.ts", "binary", "missing"];
    expect(readFilesAt(root, rev, paths)).toEqual(
      readBlobs(
        root,
        paths.map((path) => `${rev}:${path}`),
      ),
    );
    expect([...ignored(root, paths)]).toEqual(["private.secret"]);
    const fd = openSync(join(root, "huge.bin"), "w");
    ftruncateSync(fd, 16 * 1024 * 1024 * 1024);
    closeSync(fd);
    expect(readWorking(root, "huge.bin", 2 * 1024 * 1024)).toBe("\0binary");
    expect(readWorking(root, "space é.ts", 2 * 1024 * 1024)).toBe("source\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
