// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
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
import {
  changedFiles,
  ignored,
  isDirty,
  listTree,
  readBlobs,
  readFilesAt,
  readWorking,
  trackedFiles,
  untrackedFiles,
} from "./git.ts";

it("one untracked listing answers both what changed and whether the tree is dirty", async () => {
  const root = mkdtempSync(join(tmpdir(), "replay-untracked-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  // Whatever the shared listing says must be what each question asked alone says.
  const agrees = async (base: string) => {
    const listing = untrackedFiles(root);
    expect(await changedFiles(root, base, undefined, listing)).toEqual(
      await changedFiles(root, base),
    );
    expect(await isDirty(root, listing)).toBe(await isDirty(root));
    return { untracked: await listing, dirty: await isDirty(root, listing) };
  };
  try {
    git("init", "-q");
    writeFileSync(join(root, ".gitignore"), "*.log\n");
    writeFileSync(join(root, "a.ts"), "a\n");
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    const base = git("rev-parse", "HEAD");
    expect(await agrees(base)).toEqual({ untracked: [], dirty: false });

    // Replays and ignored files are not uncommitted work.
    mkdirSync(join(root, ".replays"));
    writeFileSync(join(root, ".replays", "r.json"), "{}\n");
    writeFileSync(join(root, "debug.log"), "noise\n");
    expect(await agrees(base)).toEqual({
      untracked: [".replays/r.json"],
      dirty: false,
    });

    // A change staged and then undone in the working tree is still uncommitted.
    writeFileSync(join(root, "a.ts"), "b\n");
    git("add", "a.ts");
    writeFileSync(join(root, "a.ts"), "a\n");
    expect((await agrees(base)).dirty).toBe(true);
    git("reset", "-q");

    writeFileSync(join(root, "new é.ts"), "new\n");
    expect(await agrees(base)).toEqual({
      untracked: [".replays/r.json", "new é.ts"],
      dirty: true,
    });
    // An untracked file in the listing answers on its own: git is not asked
    // again, even once the tree it was taken from is clean.
    git("add", "-A");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "everything",
    );
    expect(await isDirty(root)).toBe(false);
    expect(await isDirty(root, ["new é.ts"])).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("bulk snapshot and ignore checks preserve tracked, missing, Unicode and binary semantics", async () => {
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
    const one = readBlobs(
      root,
      paths.map((path) => `${rev}:${path}`),
    );
    expect(await readFilesAt(root, rev, paths)).toEqual(one);
    // The same from a listing asked for ahead, and without one to read.
    expect(await readFilesAt(root, rev, paths, listTree(root, rev))).toEqual(one);
    expect(await readFilesAt(root, rev, paths, Promise.resolve(undefined))).toEqual(
      one,
    );
    expect([...(await ignored(root, paths))]).toEqual(["private.secret"]);
    expect([...(await ignored(root, paths, trackedFiles(root)))]).toEqual([
      "private.secret",
    ]);
    const fd = openSync(join(root, "huge.bin"), "w");
    ftruncateSync(fd, 16 * 1024 * 1024 * 1024);
    closeSync(fd);
    expect(readWorking(root, "huge.bin", 2 * 1024 * 1024)).toBe("\0binary");
    expect(readWorking(root, "space é.ts", 2 * 1024 * 1024)).toBe("source\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
