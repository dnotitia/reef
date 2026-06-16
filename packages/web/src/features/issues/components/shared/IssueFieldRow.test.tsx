import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IssueFieldRow } from "./IssueFieldRow";

describe("IssueFieldRow", () => {
  it("renders a <label htmlFor> that associates a focusable control", () => {
    render(
      <IssueFieldRow label="Start" htmlFor="start-input">
        <input id="start-input" />
      </IssueFieldRow>,
    );
    // getByLabelText resolves when the <label htmlFor> points at the input.
    expect(screen.getByLabelText("Start")).toHaveAttribute("id", "start-input");
  });

  it("renders a <span id> for aria-labelledby controls instead of a <label>", () => {
    render(
      <IssueFieldRow label="Type" labelId="type-label">
        <button type="button" aria-labelledby="type-label">
          pick
        </button>
      </IssueFieldRow>,
    );
    const labelEl = screen.getByText("Type");
    expect(labelEl.tagName).toBe("SPAN");
    expect(labelEl).toHaveAttribute("id", "type-label");
    // The control is named by the span via aria-labelledby.
    expect(screen.getByRole("button", { name: "Type" })).toBeInTheDocument();
  });

  it("places the label and value in one property row with a fixed-width label", () => {
    render(
      <IssueFieldRow label="Due" htmlFor="due">
        <input id="due" data-testid="value" />
      </IssueFieldRow>,
    );
    const row = screen
      .getByTestId("value")
      .closest('[data-slot="issue-field-row"]');
    expect(row).not.toBeNull();
    // Fixed leading label so every value column starts at the same x.
    const label = screen.getByText("Due");
    expect(label.className).toContain("w-20");
    expect(label.className).toContain("shrink-0");
    // `min-w-0` on the row itself is load-bearing: without it this flex row,
    // being a grid item of its parent section (default `min-width: auto`),
    // would keep its content's intrinsic width and overflow the rail when a
    // value is long (e.g. a milestone name). jsdom does not measure the overflow,
    // so the class is the contract.
    expect((row as HTMLElement).className).toContain("min-w-0");
  });

  it("renders a custom labelSlot in the fixed-width gutter (create-dialog enrichment label)", () => {
    render(
      // The create dialog passes an enrichment-aware label that flips between
      // <label htmlFor> and <span>; the row should host it without losing the
      // fixed-width gutter that aligns every value column.
      <IssueFieldRow
        labelSlot={
          <label htmlFor="x" className="text-xs">
            Custom
          </label>
        }
      >
        <input id="x" data-testid="v" />
      </IssueFieldRow>,
    );
    // The slot's own <label htmlFor> still associates the control.
    expect(screen.getByLabelText("Custom")).toHaveAttribute("id", "x");
    // The row owns the gutter wrapper, so values stay aligned regardless of the
    // slot content.
    const gutter = screen.getByText("Custom").parentElement;
    expect(gutter?.className).toContain("w-20");
    expect(gutter?.className).toContain("shrink-0");
  });

  it("top-aligns the label for a multi-line value when align='start'", () => {
    render(
      <IssueFieldRow label="Labels" htmlFor="lbl" align="start">
        <input id="lbl" data-testid="v" />
      </IssueFieldRow>,
    );
    const row = screen
      .getByTestId("v")
      .closest('[data-slot="issue-field-row"]');
    expect(row?.className).toContain("items-start");
  });
});
