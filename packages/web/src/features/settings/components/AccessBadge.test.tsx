import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccessBadge } from "./AccessBadge";

describe("AccessBadge", () => {
  it("labels the editable level with text (not colour alone)", () => {
    render(<AccessBadge level="editable" />);
    expect(screen.getByTestId("access-badge-editable")).toHaveTextContent(
      "You can edit",
    );
  });

  it("labels the view-only level", () => {
    render(<AccessBadge level="view-only" />);
    expect(screen.getByTestId("access-badge-view-only")).toHaveTextContent(
      "View only",
    );
  });

  it("labels the operator-managed level", () => {
    render(<AccessBadge level="managed" />);
    expect(screen.getByTestId("access-badge-managed")).toHaveTextContent(
      "Managed by operator",
    );
  });
});
