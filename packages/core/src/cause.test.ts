import { describe, expect, it } from "vitest";

import { causeScore, isLockfile, likeliestCause } from "./cause.ts";

describe("causeScore", () => {
  it("ranks writing to a path above naming it", () => {
    expect(causeScore("cat > src/a.ts <<'EOF'\nx\nEOF", "src/a.ts")).toBe(3);
    expect(causeScore("sed -i 's/a/b/' src/a.ts", "src/a.ts")).toBe(3);
    expect(causeScore("git rm -q src/a.ts", "src/a.ts")).toBe(3);
    expect(causeScore("rm -rf build && ls", "src/a.ts")).toBe(0);
    expect(causeScore("cat src/a.ts | head", "src/a.ts")).toBe(1.5);
    expect(causeScore('import { x } from "./b.ts"', "src/a.ts")).toBe(0);
  });

  it("ranks naming a file in a script that writes above naming it in a read", () => {
    expect(causeScore("cat turbo.json | head", "turbo.json")).toBe(1.5);
    expect(causeScore("git diff turbo.json 2>/dev/null", "turbo.json")).toBe(1.5);
    expect(causeScore("node sync.js turbo.json", "turbo.json")).toBe(2);
    expect(
      causeScore(
        "python3 - <<'EOF'\np='turbo.json'; open(p,'w').write(s)\nEOF",
        "turbo.json",
      ),
    ).toBe(2.5);
  });

  it("does not read an arrow as a redirect", () => {
    expect(causeScore('const f = () => "./play.ts";', "src/play.ts")).toBe(2);
  });

  it("gives formatters and, for lockfiles, installers a weak claim", () => {
    expect(causeScore("pnpm prettier --write .", "src/a.ts")).toBe(1);
    expect(causeScore("pnpm install", "pnpm-lock.yaml")).toBe(1);
    expect(causeScore("pnpm install", "src/a.ts")).toBe(0);
    expect(isLockfile("apps/x/package-lock.json")).toBe(true);
    expect(isLockfile("src/lock.ts")).toBe(false);
  });
});

describe("causeScore with a working directory", () => {
  const context = { root: "/repo", cwd: "/repo/apps/server" };

  it("resolves a relative write through the command's cd", () => {
    expect(
      causeScore("cat > capture.ts <<'EOF'", "apps/server/capture.ts", context),
    ).toBe(3);
    // It wrote a capture.ts — just not this one.
    expect(causeScore("cat > capture.ts <<'EOF'", "core/capture.ts", context)).toBe(
      1.5,
    );
    expect(
      causeScore("cd ../../core && cat > capture.ts", "core/capture.ts", context),
    ).toBe(3);
    expect(causeScore("rm -rf ../../core/dist", "core/dist/index.js", context)).toBe(3);
    expect(
      causeScore("cp ../x/eslint.config.js .", "apps/server/src/a.ts", context),
    ).toBe(0);
  });

  it("falls back to naming when the directory cannot be followed", () => {
    expect(causeScore("cd - && cat > capture.ts", "core/capture.ts", context)).toBe(2);
  });
});

describe("likeliestCause", () => {
  it("prefers the strongest claim; a read or a write elsewhere is a weak one", () => {
    const commands = [
      { index: 1, command: "python3 edit.py play.ts" },
      { index: 4, command: "cat > test.ts <<'EOF'\nimport './play.ts'\nEOF" },
      { index: 6, command: "cat play.ts" },
    ];
    expect(likeliestCause(commands, "src/play.ts")).toBe(1);
    expect(likeliestCause(commands, "src/test.ts")).toBe(4);
    expect(likeliestCause(commands, "src/other.ts")).toBe(-1);
  });

  it("gives a change several scripts made to the last of them, never the first", () => {
    const commands = [
      { index: 2, command: "python3 - <<'EOF'\nopen('api.ts','w').write(x)\nEOF" },
      { index: 5, command: "grep -n route api.ts" },
      { index: 9, command: "python3 - <<'EOF'\nopen('api.ts','w').write(y)\nEOF" },
      { index: 12, command: "cat api.ts | head" },
    ];
    expect(likeliestCause(commands, "server/api.ts")).toBe(9);
  });

  it("does not count a redirect to /dev/null as writing somewhere else", () => {
    expect(causeScore("node gen.js play.ts 2>/dev/null", "src/play.ts")).toBe(2);
    expect(causeScore("node gen.js play.ts > out.log", "src/play.ts")).toBe(1.5);
  });
});
