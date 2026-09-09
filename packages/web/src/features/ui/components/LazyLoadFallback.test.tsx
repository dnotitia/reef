import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LazyLoadFallback } from "./LazyLoadFallback";

function renderFallback(props: Parameters<typeof LazyLoadFallback>[0]) {
  return render(
    <IntlTestProvider>
      <LazyLoadFallback {...props} />
    </IntlTestProvider>,
  );
}

describe("LazyLoadFallback", () => {
  it("keeps a loading surface announced without exposing an error", () => {
    renderFallback({
      surface: "view",
      testId: "lazy-view-loading",
    });

    expect(screen.getByTestId("lazy-view-loading")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByTestId("lazy-view-loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("offers retry and dismiss actions after a chunk failure", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const onDismiss = vi.fn();
    renderFallback({
      error: new Error("chunk failed"),
      onDismiss,
      retry,
      surface: "dialog",
      testId: "lazy-dialog-error",
    });

    expect(screen.getByTestId("lazy-dialog-error")).toHaveAttribute(
      "role",
      "alert",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
