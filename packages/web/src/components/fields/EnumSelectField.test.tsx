import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent, {
  PointerEventsCheckLevel,
} from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EnumSelectField } from "./EnumSelectField";

const STATUS_OPTIONS = ["in_progress", "in_review"] as const;

function renderStatusOption(status: (typeof STATUS_OPTIONS)[number]) {
  return status === "in_progress" ? "In Progress" : "In Review";
}

type StatusValue = (typeof STATUS_OPTIONS)[number];

function ControlledStatusSelect({
  onValueChange,
  testId = "status-select",
}: {
  onValueChange?: (value: string) => void;
  testId?: string;
}) {
  const [value, setValue] = useState<StatusValue>("in_progress");

  return (
    <EnumSelectField
      value={value}
      onValueChange={(nextValue) => {
        setValue(nextValue as StatusValue);
        onValueChange?.(nextValue);
      }}
      options={STATUS_OPTIONS}
      renderItem={renderStatusOption}
      testId={testId}
    />
  );
}

function NestedSelectHarness({ onSheetEscape }: { onSheetEscape: () => void }) {
  return (
    <Sheet open>
      <SheetContent
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onSheetEscape();
        }}
      >
        <SheetTitle>Details</SheetTitle>
        <SheetDescription>Details</SheetDescription>
        <ControlledStatusSelect testId="nested-status-select" />
      </SheetContent>
    </Sheet>
  );
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

  it("returns focus to the trigger when Escape closes a reopened keyboard selection", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ControlledStatusSelect onValueChange={onValueChange} />);

    const trigger = screen.getByTestId("status-select");
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onValueChange).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );

    await user.keyboard("{Enter}");
    const listbox = await screen.findByRole("listbox");
    expect(document.activeElement).toBeInstanceOf(HTMLElement);
    expect(listbox).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(trigger);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveTextContent("In Review");
  });

  it("closes the select before the surrounding sheet handles Escape", async () => {
    const user = userEvent.setup();
    const onSheetEscape = vi.fn();
    render(
      <StrictMode>
        <NestedSelectHarness onSheetEscape={onSheetEscape} />
      </StrictMode>,
    );

    const trigger = screen.getByTestId("nested-status-select");
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );

    await user.keyboard("{Enter}");
    const listbox = await screen.findByRole("listbox");
    expect(document.activeElement).toBeInstanceOf(HTMLElement);
    expect(listbox).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(trigger);
    expect(onSheetEscape).not.toHaveBeenCalled();
  });

  it("preserves Space and pointer open, selection, and outside-click paths", async () => {
    const user = userEvent.setup({
      // Radix temporarily sets body pointer-events to none while its modal
      // listbox is open; the outside click itself is the behavior under test.
      pointerEventsCheck: PointerEventsCheckLevel.Never,
    });
    const onValueChange = vi.fn();
    render(<ControlledStatusSelect onValueChange={onValueChange} />);

    const trigger = screen.getByTestId("status-select");
    trigger.focus();
    await user.keyboard(" ");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "In Review" }));
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(onValueChange).toHaveBeenCalledWith("in_review");
    expect(trigger).toHaveTextContent("In Review");

    await user.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
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
