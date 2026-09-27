import { describe, expect, it } from "vitest";

import { shellWrites } from "./shell.ts";

describe("shellWrites", () => {
  it("reads a quoted heredoc written with cat", () => {
    const command = "cat > src/a.ts <<'EOF'\nconst a = `${b}`;\nEOF";
    expect(shellWrites(command, "/repo")).toEqual([
      { path: "/repo/src/a.ts", content: "const a = `${b}`;\n", append: false },
    ]);
  });

  it("follows cd, appends, tee and several files in one command", () => {
    const command = [
      "cd /repo/pkg && cat <<'A' > one.txt",
      "one",
      "A",
      'cat >> two.txt << "B"',
      "two",
      "B",
      "cat <<'C' | tee three.txt >/dev/null",
      "three",
      "C",
      "tee -a four.txt <<'D'",
      "four",
      "D",
    ].join("\n");
    expect(shellWrites(command, "/elsewhere")).toEqual([
      { path: "/repo/pkg/one.txt", content: "one\n", append: false },
      { path: "/repo/pkg/two.txt", content: "two\n", append: true },
      { path: "/repo/pkg/three.txt", content: "three\n", append: false },
      { path: "/repo/pkg/four.txt", content: "four\n", append: true },
    ]);
  });

  it("leaves what the shell would expand, and scripts, alone", () => {
    expect(shellWrites("cat > a.sh <<EOF\necho $HOME\nEOF", "/r")).toEqual([]);
    expect(shellWrites("cat > a.txt <<EOF\nplain\nEOF", "/r")).toEqual([
      { path: "/r/a.txt", content: "plain\n", append: false },
    ]);
    expect(shellWrites("python3 - <<'EOF' > out.json\nprint(1)\nEOF", "/r")).toEqual(
      [],
    );
    expect(shellWrites("cat > a.txt <<'EOF'\nnever closed", "/r")).toEqual([]);
  });

  it("strips leading tabs for <<-", () => {
    expect(shellWrites("cat > a <<-'EOF'\n\tindented\n\tEOF", "/r")).toEqual([
      { path: "/r/a", content: "indented\n", append: false },
    ]);
  });
});
