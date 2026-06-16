import type { EnrichmentSuggestion } from "@reef/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FieldSuggestionEntry } from "../lib/inlineEnrichment";
import { FieldSuggestion } from "./FieldSuggestion";

function entryFor(
  suggestion: EnrichmentSuggestion,
  needsReview = false,
): FieldSuggestionEntry {
  return { suggestion, status: "pending", needsReview };
}

const PRIORITY: EnrichmentSuggestion = {
  field: "priority",
  value: "high",
  reasoning: "affects all users",
  confidence: 0.9,
};

describe("FieldSuggestion", () => {
  it("renders confidence, reasoning, and current→suggested", () => {
    render(
      <FieldSuggestion
        field="priority"
        entry={entryFor(PRIORITY)}
        currentDisplay={<span>No priority</span>}
        suggestedDisplay={<span>High</span>}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId("field-suggestion")).toHaveAttribute(
      "data-field",
      "priority",
    );
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("affects all users")).toBeInTheDocument();
    expect(screen.getByText("No priority")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("shows the needs-review flag only when low confidence", () => {
    const { rerender } = render(
      <FieldSuggestion
        field="priority"
        entry={entryFor(PRIORITY, false)}
        currentDisplay={null}
        suggestedDisplay={null}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("field-suggestion-needs-review-priority"),
    ).not.toBeInTheDocument();

    rerender(
      <FieldSuggestion
        field="priority"
        entry={entryFor(PRIORITY, true)}
        currentDisplay={null}
        suggestedDisplay={null}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("field-suggestion-needs-review-priority"),
    ).toBeInTheDocument();
  });

  it("fires onAccept / onDismiss from the buttons", async () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    render(
      <FieldSuggestion
        field="priority"
        entry={entryFor(PRIORITY)}
        currentDisplay={null}
        suggestedDisplay={null}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    await userEvent.click(
      screen.getByTestId("field-suggestion-accept-priority"),
    );
    await userEvent.click(
      screen.getByTestId("field-suggestion-dismiss-priority"),
    );
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders the diff slot instead of the value row when provided", () => {
    render(
      <FieldSuggestion
        field="title"
        entry={entryFor({
          field: "title",
          value: "New title",
          reasoning: "clarity",
          confidence: 0.8,
        })}
        currentDisplay={<span>should-not-render</span>}
        suggestedDisplay={<span>should-not-render</span>}
        diff={<div data-testid="custom-diff">diff here</div>}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId("custom-diff")).toBeInTheDocument();
    expect(screen.queryByText("should-not-render")).not.toBeInTheDocument();
  });
});
