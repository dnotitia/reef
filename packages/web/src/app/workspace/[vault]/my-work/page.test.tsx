import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/my-work/components/MyWorkPage", async () => {
  const { lazy } = await import("react");
  return { MyWorkPage: lazy(() => new Promise<never>(() => {})) };
});

import MyWorkLoading from "./loading";
import MyWorkRoute from "./page";

describe("MyWork route", () => {
  it("paints the My Work skeleton as the Suspense fallback (REEF-255)", () => {
    render(<MyWorkRoute />);
    expect(screen.getByTestId("my-work-skeleton")).toBeInTheDocument();
  });

  it("route loading.tsx renders the same skeleton", () => {
    render(<MyWorkLoading />);
    expect(screen.getByTestId("my-work-skeleton")).toBeInTheDocument();
  });
});
