import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormSection } from "./FormSection";

describe("FormSection", () => {
  it("uses the canonical detail-section role for form headings", () => {
    render(
      <FormSection title="Details">
        <div>content</div>
      </FormSection>,
    );

    expect(
      screen.getByRole("heading", { name: "Details", level: 3 }),
    ).toHaveClass("type-detail-section");
  });
});
