import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReadOnlyValue } from "./ReadOnlyValue";

describe("ReadOnlyValue", () => {
  it("renders the value as plain text", () => {
    render(<ReadOnlyValue value="REEF" testId="v" />);
    expect(screen.getByTestId("v")).toHaveTextContent("REEF");
  });

  it("collapses an empty value to an em dash", () => {
    render(<ReadOnlyValue value="" testId="v" />);
    expect(screen.getByTestId("v")).toHaveTextContent("—");
  });

  it("collapses a null value to an em dash", () => {
    render(<ReadOnlyValue value={null} testId="v" />);
    expect(screen.getByTestId("v")).toHaveTextContent("—");
  });

  it("applies the mono stack for code-shaped values", () => {
    render(<ReadOnlyValue value="main" mono testId="v" />);
    expect(screen.getByTestId("v").className).toContain("font-mono");
  });
});
