import { describe, expect, it } from "vitest";

import { parseBlocks, plainText } from "./markdown-parse";

describe("parseBlocks", () => {
  it("reads the blocks a lesson is written in", () => {
    const blocks = parseBlocks(
      [
        "## Dot product",
        "",
        "Two vectors, one number:",
        "",
        "$$",
        "a \\cdot b = a_x b_x + a_y b_y",
        "$$",
        "",
        "- it is **symmetric**",
        "- it is linear:",
        "  in each argument",
        "  1. first",
        "  2. second",
        "",
        "```ts",
        "dot(a, b);",
        "```",
        "",
        "| name | kind |",
        "| --- | --- |",
        "| add | function |",
        "",
        "> A note.",
      ].join("\n"),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "math",
      "list",
      "code",
      "table",
      "quote",
    ]);
    const list = blocks[3]!;
    expect(list.kind === "list" && list.items).toHaveLength(2);
    expect(list.kind === "list" && list.items[1]!.map((b) => b.kind)).toEqual([
      "paragraph",
      "list",
    ]);
    expect(blocks[2]).toEqual({ kind: "math", text: "a \\cdot b = a_x b_x + a_y b_y" });
    expect(blocks[5]).toEqual({
      kind: "table",
      head: ["name", "kind"],
      rows: [["add", "function"]],
    });
  });

  it("keeps a paragraph whole across lines, and one-line display maths", () => {
    expect(parseBlocks("one\ntwo\n\n$$x^2$$")).toEqual([
      { kind: "paragraph", text: "one two" },
      { kind: "math", text: "x^2" },
    ]);
  });
});

describe("plainText", () => {
  it("keeps captions readable without revealing collapsed worked answers", () => {
    expect(
      plainText(
        "> [!NOTE] Evidence\n> Read the source.\n\n:::details Worked answer\nA bounded result.\n:::",
      ),
    ).toBe("Evidence Read the source. Worked answer");
    expect(
      plainText(
        "Before\n\n:::details First\nHidden one\n:::\n\nBetween\n\n:::details Second\nHidden two\n:::\n\nAfter",
      ),
    ).toBe("Before First Between Second After");
  });
  it("drops the markup, keeps the words", () => {
    expect(plainText("## Why **this** [works](https://x)\n\n`code`")).toBe(
      "Why this works code",
    );
  });
});
