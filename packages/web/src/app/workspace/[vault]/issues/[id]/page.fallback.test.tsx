import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Separate file from page.test.tsx: that suite mocks IssuesWorkspace to a
// non-suspending backdrop, but here we need it to suspend so the backdrop's
// Suspense boundary falls back to the workspace skeleton — the deep-link
// equivalent of the /issues fallback (REEF-255 AC1).
//
// `use(params)` is mocked to resolve synchronously (same approach as the sibling
// REEF-165 suite) so the test isolates the *inner* backdrop Suspense; the sheet
// and router are stubbed out.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, use: vi.fn((val: unknown) => val) };
});
vi.mock("@/features/issues/components/filters/IssuesWorkspace", async () => {
  const { lazy } = await import("react");
  return { IssuesWorkspace: lazy(() => new Promise<never>(() => {})) };
});
vi.mock("@/features/issues/components/detail/IssueDetailSheet", () => ({
  IssueDetailSheet: () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

import IssuePage from "./page";

describe("IssuePage (deep-link backdrop fallback)", () => {
  it("paints the workspace skeleton behind the sheet while suspended (REEF-255)", () => {
    render(
      <IssuePage
        params={
          { id: "REEF-1", vault: "reef-acme" } as unknown as Promise<{
            id: string;
            vault: string;
          }>
        }
      />,
    );

    expect(screen.getByTestId("issues-skeleton")).toBeInTheDocument();
  });
});
