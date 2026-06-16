import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Root redirect logic (src/app/page.tsx) uses IndexedDB (Dexie) and
// next/navigation inside a useEffect, so the full redirect decision tree is
// verified by the Playwright E2E spec in tests/e2e/. Here we stub the redirect
// hook to assert the first-paint shell in isolation.
//
// Redirect contract (post-lean-onboarding):
//   - no akb session    → /login
//   - session, no vault → /onboarding
//   - session + vault   → /issues
const useAuthRedirect = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/hooks/useAuthRedirect", () => ({ useAuthRedirect }));

import RootPage from "./page";

afterEach(() => {
  cleanup();
  useAuthRedirect.mockClear();
});

describe("apps/web root page", () => {
  it("paints the board app-shell skeleton, not a bare Loading… line (REEF-097 AC2)", () => {
    render(<RootPage />);

    // The visual first paint is the board shell skeleton…
    expect(screen.getByTestId("app-shell-skeleton")).toBeDefined();
    // …while the loading announcement survives just as an sr status, so
    // assistive tech still hears a loading state without a bare visible line.
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Loading…");
    expect(status.className).toContain("sr-only");
  });

  it("still runs the root redirect gate", () => {
    render(<RootPage />);
    expect(useAuthRedirect).toHaveBeenCalledWith("root");
  });
});
