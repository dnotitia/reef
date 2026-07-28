import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useAuthRedirect = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/hooks/useAuthRedirect", () => ({ useAuthRedirect }));

import WorkspaceRootPage from "./page";

afterEach(() => {
  cleanup();
  useAuthRedirect.mockClear();
});

describe("workspace root page (REEF-424)", () => {
  it("reuses the global root auth and remembered-workspace redirect contract", () => {
    render(<WorkspaceRootPage />);

    expect(useAuthRedirect).toHaveBeenCalledWith("root");
  });

  it("keeps the app-shell skeleton visible while the client redirect resolves", () => {
    render(<WorkspaceRootPage />);

    expect(screen.getByTestId("app-shell-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("sr-only");
  });
});
