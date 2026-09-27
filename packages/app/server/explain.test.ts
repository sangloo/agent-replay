// @vitest-environment node
import { buildHistory } from "@agent-replay/core";
import { describe, expect, it } from "vitest";

import { explain, groups, promptFor, type MessagesClient } from "./explain.ts";

const replay = buildHistory(
  [
    {
      sha: "a1",
      subject: "Initial commit",
      at: "2026-01-01T00:00:00Z",
      introduces: true,
      changes: ["README.md", "src/index.ts", "src/a.ts", "src/b.ts", "src/c.ts"].map(
        (path) => ({
          path,
          after: `// ${path}\n`,
        }),
      ),
    },
    {
      sha: "b2",
      subject: "Tighten a",
      at: "2026-01-02T00:00:00Z",
      changes: [{ path: "src/a.ts", after: "// src/a.ts, tighter\n" }],
    },
  ],
  { repo: { name: "demo", commits: [] }, base: {}, title: "demo" },
);

function fake(
  answers: (prompt: string) => unknown,
): MessagesClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    messages: {
      create: (async (params: { messages: { content: string }[] }) => {
        const prompt = params.messages[0]!.content;
        prompts.push(prompt);
        return {
          content: [{ type: "text", text: JSON.stringify(answers(prompt)) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 20 },
        };
      }) as unknown as MessagesClient["messages"]["create"],
    },
  };
}

describe("explain", () => {
  it("asks for a tour where many files arrive, and a summary per commit after", () => {
    const [first, second] = groups(replay);
    expect(first).toMatchObject({ introduces: true });
    expect(first!.frames).toHaveLength(5);
    expect(promptFor(replay, first!)).toContain("short tour");
    expect(promptFor(replay, second!)).toContain("what this commit changed");
  });

  it("merges the model's notes, dropping ids it made up and never overwriting", async () => {
    const client = fake((prompt) =>
      prompt.includes("short tour")
        ? {
            notes: [
              { id: "commit:a1", level: "info", text: "Start at src/index.ts." },
              { id: "a1:src/a.ts", level: "info", text: "Holds a." },
              { id: "made-up", level: "info", text: "x" },
            ],
          }
        : { notes: [{ id: "commit:b2", level: "review", text: "a got stricter." }] },
    );
    const annotated = {
      ...replay,
      notes: { "commit:b2": { level: "info" as const, text: "Mine." } },
    };
    const result = await explain(annotated, client);
    expect(client.prompts).toHaveLength(2);
    expect(result.replay.notes).toEqual({
      "commit:a1": { level: "info", text: "Start at src/index.ts." },
      "a1:src/a.ts": { level: "info", text: "Holds a." },
      "commit:b2": { level: "info", text: "Mine." },
    });
    expect(result).toMatchObject({
      added: 2,
      requests: 2,
      inputTokens: 200,
      outputTokens: 40,
    });
  });

  it("keeps what succeeded when one request fails, and fails only when all do", async () => {
    let calls = 0;
    const flaky: MessagesClient = {
      messages: {
        create: (async () => {
          calls++;
          if (calls === 1) throw new Error("overloaded");
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  notes: [{ id: "commit:b2", level: "info", text: "Tightened." }],
                }),
              },
            ],
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        }) as unknown as MessagesClient["messages"]["create"],
      },
    };
    const result = await explain(replay, flaky);
    expect(result.failed).toBe(1);
    expect(result.replay.notes["commit:b2"]).toEqual({
      level: "info",
      text: "Tightened.",
    });

    const down: MessagesClient = {
      messages: {
        create: (async () => {
          throw new Error("down");
        }) as unknown as MessagesClient["messages"]["create"],
      },
    };
    await expect(explain(replay, down)).rejects.toThrow("down");
  });
});
