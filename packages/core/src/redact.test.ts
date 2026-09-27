import { describe, expect, it } from "vitest";

import { redact } from "./redact.ts";

describe("redact", () => {
  it("turns a home folder into ~, on every platform", () => {
    expect(redact("cd /Users/ada/code/app && pnpm test")).toBe(
      "cd ~/code/app && pnpm test",
    );
    expect(redact("open /home/ada/notes.md")).toBe("open ~/notes.md");
    expect(redact("C:\\Users\\ada\\code")).toBe("~\\code");
    expect(redact("the file is in /Users/ada")).toBe("the file is in ~");
  });

  it("leaves paths that are not a home folder alone", () => {
    expect(redact("/usr/local/bin/node and /opt/homebrew")).toBe(
      "/usr/local/bin/node and /opt/homebrew",
    );
    expect(redact("apps/replay/src/home/users.ts")).toBe(
      "apps/replay/src/home/users.ts",
    );
  });

  it("still scrubs keys and emails", () => {
    expect(redact("token=abcdefghijklmnop and a@b.co")).toBe(
      "token=[redacted] and [email]",
    );
  });
});
