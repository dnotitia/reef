import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CloseIssueDialog } from "./CloseIssueDialog";

function renderDialog() {
  return render(
    <CloseIssueDialog
      open
      issueId="REEF-272"
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
}

describe("CloseIssueDialog (REEF-272)", () => {
  // Radix Select drives its popover with pointer-capture + scrollIntoView APIs
  // jsdom doesn't implement; stub them so the reason dropdown can open.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("shows the selected reason as a single-line label on the trigger, without the hint", () => {
    renderDialog();

    // Default reason is "completed": the trigger shows the label while the
    // two-line hint that used to squish in the single-line slot stays out.
    const trigger = screen.getByTestId("closed-reason-select");
    expect(trigger).toHaveTextContent("Completed");
    expect(trigger).not.toHaveTextContent("The work is finished and accepted.");
  });

  it("keeps the label + hint two-line rows in the open dropdown", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByTestId("closed-reason-select"));
    // The hint lives in the dropdown option, outside the trigger.
    expect(
      await screen.findByText("The work is finished and accepted."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Another issue already tracks this work."),
    ).toBeInTheDocument();
  });

  it("uses a scale-token max-width matching sibling dialogs (AC4)", () => {
    renderDialog();

    const content = screen.getByTestId("close-issue-dialog");
    expect(content.className).toContain("max-w-md");
    expect(content.className).not.toContain("max-w-[420px]");
  });

  it("drops the decorative 'Closed' chip and the tinted field card (AC5)", () => {
    renderDialog();

    // The header now mirrors DeleteIssueDialog / PlanningEditorDialog: title +
    // description, with no standalone "Closed" status chip above the title.
    expect(screen.queryByText("Closed", { exact: true })).toBeNull();

    // The single field is a plain label + control stack, not a tinted-border
    // card wrapper.
    const fieldWrapper = screen.getByText("Close reason").parentElement;
    expect(fieldWrapper?.className).toContain("flex flex-col gap-1");
    expect(fieldWrapper?.className).not.toContain("border");
  });
});
