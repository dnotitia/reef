import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EnrichmentReviewBar } from "./EnrichmentReviewBar";

describe("EnrichmentReviewBar", () => {
  it("shows the loading strip when isLoading", () => {
    render(
      <EnrichmentReviewBar
        pending={0}
        accepted={0}
        onAcceptAll={vi.fn()}
        onDismissAll={vi.fn()}
        isLoading
      />,
    );
    expect(screen.getByTestId("enrichment-review-loading")).toBeInTheDocument();
    expect(
      screen.queryByTestId("enrichment-review-bar"),
    ).not.toBeInTheDocument();
  });

  it("shows error with a retry that fires onRetry", async () => {
    const onRetry = vi.fn();
    render(
      <EnrichmentReviewBar
        pending={0}
        accepted={0}
        onAcceptAll={vi.fn()}
        onDismissAll={vi.fn()}
        error="AI enrichment is unavailable."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByTestId("enrichment-review-error")).toHaveTextContent(
      "AI enrichment is unavailable.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the empty note when isEmpty", () => {
    render(
      <EnrichmentReviewBar
        pending={0}
        accepted={0}
        onAcceptAll={vi.fn()}
        onDismissAll={vi.fn()}
        isEmpty
      />,
    );
    expect(screen.getByTestId("enrichment-review-empty")).toBeInTheDocument();
  });

  it("dismisses the empty note via onClose", async () => {
    const onClose = vi.fn();
    render(
      <EnrichmentReviewBar
        pending={0}
        accepted={0}
        onAcceptAll={vi.fn()}
        onDismissAll={vi.fn()}
        isEmpty
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByTestId("enrichment-review-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses the error banner via onClose", async () => {
    const onClose = vi.fn();
    render(
      <EnrichmentReviewBar
        pending={0}
        accepted={0}
        onAcceptAll={vi.fn()}
        onDismissAll={vi.fn()}
        error="AI enrichment is unavailable."
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByTestId("enrichment-review-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders progress counts and wires accept-all / dismiss-all", async () => {
    const onAcceptAll = vi.fn();
    const onDismissAll = vi.fn();
    render(
      <EnrichmentReviewBar
        pending={3}
        accepted={1}
        onAcceptAll={onAcceptAll}
        onDismissAll={onDismissAll}
      />,
    );
    const bar = screen.getByTestId("enrichment-review-bar");
    expect(bar).toHaveTextContent("3 to review");
    expect(bar).toHaveTextContent("1 applied");

    await userEvent.click(screen.getByTestId("enrichment-accept-all"));
    await userEvent.click(screen.getByTestId("enrichment-dismiss-all"));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
    expect(onDismissAll).toHaveBeenCalledTimes(1);
  });

  it("disables the global actions when nothing is pending", () => {
    render(
      <EnrichmentReviewBar
        pending={0}
        accepted={2}
        onAcceptAll={vi.fn()}
        onDismissAll={vi.fn()}
      />,
    );
    expect(screen.getByTestId("enrichment-accept-all")).toBeDisabled();
    expect(screen.getByTestId("enrichment-dismiss-all")).toBeDisabled();
  });
});
