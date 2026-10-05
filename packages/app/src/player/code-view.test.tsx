import { fireEvent, render } from "@testing-library/react";
import { expect, it } from "vitest";
import { CodeView } from "./code-view";

it("bounds mounted code rows and renders distant lines when scrolled", () => {
  const content = Array.from({ length: 20_000 }, (_, i) => `line ${i + 1}`).join("\n");
  const { container, rerender } = render(
    <CodeView path="large.txt" content={content} progress={1} />,
  );
  const box = container.firstElementChild as HTMLElement;
  expect(container.querySelectorAll("[data-line]").length).toBeLessThan(100);
  expect(container.textContent).toContain("line 1");
  fireEvent.scroll(box, { target: { scrollTop: 220_000 } });
  expect(container.querySelectorAll("[data-line]").length).toBeLessThan(100);
  expect(container.textContent).toContain("line 10001");
  expect(container.querySelector('[data-line="0"]')).toBeNull();
  rerender(<CodeView path="small.txt" content="small file" progress={1} />);
  expect(container.textContent).toContain("small file");
});
