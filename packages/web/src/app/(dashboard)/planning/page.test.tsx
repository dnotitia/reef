import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/planning/components/PlanningPage", async () => {
  const { lazy } = await import("react");
  return { PlanningPage: lazy(() => new Promise<never>(() => {})) };
});

import PlanningLoading from "./loading";
import PlanningRoute from "./page";

describe("Planning route", () => {
  it("paints the Planning skeleton as the Suspense fallback (REEF-255)", () => {
    render(<PlanningRoute />);
    expect(screen.getByTestId("planning-skeleton")).toBeInTheDocument();
  });

  it("route loading.tsx renders the same skeleton", () => {
    render(<PlanningLoading />);
    expect(screen.getByTestId("planning-skeleton")).toBeInTheDocument();
  });
});
