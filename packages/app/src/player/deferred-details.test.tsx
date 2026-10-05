import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DeferredDetails } from "./deferred-details";

it("does not render expensive content until expanded and releases it when closed", () => {
  const expensive = vi.fn();
  function Body() {
    expensive();
    return <p>Reference body</p>;
  }
  const { container } = render(
    <DeferredDetails summary="Advanced">
      <Body />
    </DeferredDetails>,
  );
  expect(expensive).not.toHaveBeenCalled();
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(screen.getByText("Reference body")).toBeVisible();
  details.open = false;
  fireEvent(details, new Event("toggle"));
  expect(screen.queryByText("Reference body")).toBeNull();
});
