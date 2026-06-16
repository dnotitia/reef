import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UnreviewedSummaryCard } from "./UnreviewedSummaryCard";

describe("UnreviewedSummaryCard", () => {
  it("renders with draft and note counts", () => {
    render(
      <UnreviewedSummaryCard
        draftCount={2}
        statusChangeCount={1}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByTestId("unreviewed-summary-card")).toBeInTheDocument();
    expect(screen.getByText(/Since you were last here/)).toBeInTheDocument();
    expect(screen.getByText(/2 new AI drafts/)).toBeInTheDocument();
    expect(screen.getByText(/1 status change/)).toBeInTheDocument();
  });

  it("renders with only draft counts", () => {
    render(
      <UnreviewedSummaryCard
        draftCount={1}
        statusChangeCount={0}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByTestId("unreviewed-summary-card")).toBeInTheDocument();
    expect(screen.getByText(/1 new AI draft/)).toBeInTheDocument();
    expect(screen.queryByText(/status change/)).not.toBeInTheDocument();
  });

  it("does not render when both counts are 0", () => {
    render(
      <UnreviewedSummaryCard
        draftCount={0}
        statusChangeCount={0}
        onDismiss={() => {}}
      />,
    );

    expect(
      screen.queryByTestId("unreviewed-summary-card"),
    ).not.toBeInTheDocument();
  });

  it("calls onDismiss when 'Got it' button is clicked", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(
      <UnreviewedSummaryCard
        draftCount={1}
        statusChangeCount={0}
        onDismiss={onDismiss}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Got it/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
