import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/planning/components/SprintDetailPage", async () => {
  const { lazy } = await import("react");
  return { SprintDetailPage: lazy(() => new Promise<never>(() => {})) };
});

import SprintDetailLoading from "./loading";
import SprintDetailRoute from "./page";

describe("Sprint detail route", () => {
  it("uses the detail skeleton as the Suspense fallback", () => {
    render(<SprintDetailRoute />);
    expect(screen.getByTestId("sprint-detail-skeleton")).toBeInTheDocument();
  });

  it("uses the same geometry for route loading", () => {
    render(<SprintDetailLoading />);
    expect(screen.getByTestId("sprint-detail-skeleton")).toBeInTheDocument();
  });
});
