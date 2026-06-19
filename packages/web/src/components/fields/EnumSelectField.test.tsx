import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

describe("EnumSelectField renderValue split (REEF-272)", () => {
  // Radix Select drives its popover with pointer-capture + scrollIntoView APIs
  // jsdom doesn't implement; stub them so the dropdown can open.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  const renderTwoLineItem = (status: (typeof STATUS_OPTIONS)[number]) => (
    <span className="flex flex-col">
      <span>{renderStatusOption(status)}</span>
      <span>hint:{status}</span>
    </span>
  );

  it("draws the trigger from renderValue while options keep the rich renderItem", async () => {
    const user = userEvent.setup();
    render(
      <EnumSelectField
        value="in_progress"
        onValueChange={vi.fn()}
        options={STATUS_OPTIONS}
        renderItem={renderTwoLineItem}
        renderValue={(status) => (
          <span>value:{renderStatusOption(status)}</span>
        )}
        testId="status-select"
      />,
    );

    // The trigger shows the compact, single-line renderValue instead of the
    // two-line renderItem hint that used to squish in the single-line slot.
    const trigger = screen.getByTestId("status-select");
    expect(trigger).toHaveTextContent("value:In Progress");
    expect(trigger).not.toHaveTextContent("hint:in_progress");

    // The dropdown options still render the full label + hint via renderItem.
    await user.click(trigger);
    expect(await screen.findByText("hint:in_review")).toBeInTheDocument();
  });

  it("falls back to renderItem on the trigger when renderValue is absent", () => {
    render(
      <EnumSelectField
        value="in_progress"
        onValueChange={vi.fn()}
        options={STATUS_OPTIONS}
        renderItem={renderTwoLineItem}
        testId="status-select"
      />,
    );

    // No renderValue → the trigger keeps the existing renderItem output, so
    // every single-line caller renders unchanged.
    expect(screen.getByTestId("status-select")).toHaveTextContent(
      "hint:in_progress",
    );
  });
});
