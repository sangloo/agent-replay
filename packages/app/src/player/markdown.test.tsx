import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "./markdown";
import { SourceNavigationContext } from "./source-context";

describe("teaching Markdown", () => {
  it("renders callouts and collapsible explanations as safe structured elements", () => {
    const { container } = render(
      <Markdown
        text={
          "> [!WARNING] Outcome unknown\n> Do **not** release.\n\n:::details Worked example\nThe result is `3`.\n:::"
        }
      />,
    );
    expect(
      screen.getByRole("complementary", { name: "Outcome unknown" }),
    ).toHaveTextContent("Do not release.");
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container.querySelector("summary")).toHaveTextContent("Worked example");
  });
  it("navigates a function label using exact source coordinates and exposes a preview", () => {
    const navigate = vi.fn();
    const destination = {
      path: "a.go",
      lines: [8, 9] as [number, number],
      displayed: [3, 4] as [number, number],
      cursor: 5,
      preview: "func Read() {}",
    };
    render(
      <SourceNavigationContext.Provider
        value={{ resolve: () => ({ destination }), navigate }}
      >
        <Markdown text="[Read](source:a.go#L8-L9)" />
      </SourceNavigationContext.Provider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Go to Read, original lines 8–9" }),
    );
    expect(navigate).toHaveBeenCalledWith(destination);
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent(
      "replay lines 3–4",
    );
  });
  it("marks unavailable source spans and never turns them into external links", () => {
    render(<Markdown text="[Unknown](source:a.go#L8-L9)" />);
    expect(screen.getByRole("button", { name: /Unknown: Original/ })).toBeDisabled();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("does not execute HTML or unsafe URL schemes in any extension", () => {
    const { container } = render(
      <Markdown
        text={
          "<script>alert(1)</script>\n\n:::details <img src=x onerror=alert(1)>\n[bad](javascript:alert) [data](data:text/html,bad) [slash](/\\evil.example)\n:::\n\n> [!NOTE] <svg onload=alert(1)>\n> <iframe src=x>"
        }
      />,
    );
    expect(container.querySelector("script,iframe,img,svg,a")).toBeNull();
    expect(container).toHaveTextContent("<script>");
  });
  it("preserves ordinary Markdown and treats unterminated details as text", () => {
    render(
      <Markdown
        text={
          "## Existing lesson\n\n[Docs](https://example.com) and **bold**.\n\n:::details Unclosed\nplain text"
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Existing lesson" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "rel",
      "noreferrer",
    );
    expect(screen.getByText(/:::details Unclosed/)).toBeVisible();
  });
});
