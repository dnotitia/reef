import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EnumSelectField } from "./EnumSelectField";

const STATUS_OPTIONS = ["in_progress", "in_review"] as const;

function renderStatusOption(status: (typeof STATUS_OPTIONS)[number]) {
  return status === "in_progress" ? "In Progress" : "In Review";
}

describe("EnumSelectField", () => {
  it("renders the trigger from the controlled value after rerender", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <EnumSelectField
        value="in_progress"
        onValueChange={onValueChange}
        options={STATUS_OPTIONS}
        renderItem={renderStatusOption}
        testId="status-select"
      />,
    );

    const trigger = screen.getByTestId("status-select");
    expect(trigger).toHaveTextContent("In Progress");

    rerender(
      <EnumSelectField
        value="in_review"
        onValueChange={onValueChange}
        options={STATUS_OPTIONS}
        renderItem={renderStatusOption}
        testId="status-select"
      />,
    );

    expect(trigger).toHaveTextContent("In Review");
    expect(trigger).not.toHaveTextContent("In Progress");
  });
});
