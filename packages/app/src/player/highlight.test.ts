import { describe, expect, it } from "vitest";

import { languageOf, paint, tokenize } from "./highlight";

describe("highlight", () => {
  it("picks a language from the path", () => {
    expect(languageOf("src/a.tsx")).toBe("typescript");
    expect(languageOf("cmd/server/main.go")).toBe("go");
    expect(languageOf("LICENSE")).toBeUndefined();
  });

  it("colours tokens by character offset", () => {
    const text = 'const a = "hi"; // note';
    const runs = tokenize(text, "typescript");
    const painted = paint(text, 0, runs);
    expect(painted.map((p) => p.text).join("")).toBe(text);
    expect(painted.find((p) => p.text === "const")?.category).toBe("keyword");
    expect(painted.find((p) => p.text === '"hi"')?.category).toBe("string");
    expect(painted.find((p) => p.text === "// note")?.category).toBe("comment");
  });

  it("paints a slice that starts mid-source", () => {
    const text = 'const a = "hi";';
    const runs = tokenize(text, "typescript");
    const slice = paint(text.slice(6), 6, runs);
    expect(slice.map((p) => p.text).join("")).toBe(text.slice(6));
    expect(slice.find((p) => p.text === '"hi"')?.category).toBe("string");
  });
});
