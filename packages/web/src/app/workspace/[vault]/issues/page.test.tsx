import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Force the page's Suspense boundary into its fallback by making the workspace
// suspend indefinitely (a lazy component whose import stays pending). This is
// the hard-nav / refresh first paint, where the fallback is the skeleton
// and not a blank body (REEF-255 AC1).
vi.mock("@/features/issues/components/filters/IssuesWorkspace", async () => {
  const { lazy } = await import("react");
  return { IssuesWorkspace: lazy(() => new Promise<never>(() => {})) };
});

import IssuesLoading from "./loading";
import IssuesPage from "./page";

describe("IssuesPage", () => {
  it("paints the workspace skeleton as the Suspense fallback (REEF-255)", () => {
    render(<IssuesPage />);
    expect(screen.getByTestId("issues-skeleton")).toBeInTheDocument();
  });

  it("route loading.tsx renders the same workspace skeleton", () => {
    render(<IssuesLoading />);
    expect(screen.getByTestId("issues-skeleton")).toBeInTheDocument();
  });
});
