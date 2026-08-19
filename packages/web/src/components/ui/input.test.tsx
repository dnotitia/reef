import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

describe("Input accessibility contract", () => {
  it("preserves the state owner's label, invalid, description, and busy relationships", () => {
    render(
      <>
        <label htmlFor="issue-title">Title</label>
        <Input
          id="issue-title"
          aria-invalid="true"
          aria-describedby="issue-title-error issue-title-help"
          aria-busy="true"
        />
        <p id="issue-title-help">A short issue title.</p>
        <p id="issue-title-error">Title is required.</p>
      </>,
    );

    const input = screen.getByRole("textbox", { name: "Title" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "issue-title-error issue-title-help",
    );
    expect(input).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
