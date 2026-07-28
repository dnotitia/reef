import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useAuthRedirect = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/hooks/useAuthRedirect", () => ({ useAuthRedirect }));
const useWorkspaceAutoResume = vi.hoisted(() =>
  vi.fn(() => ({ status: "disabled", retry: vi.fn() })),
);
vi.mock("@/features/onboarding/hooks/useWorkspaceAutoResume", () => ({
  useWorkspaceAutoResume,
}));

import WorkspaceRootPage from "./page";

afterEach(() => {
  cleanup();
  useAuthRedirect.mockClear();
  useWorkspaceAutoResume.mockClear();
});

describe("workspace root page (REEF-424)", () => {
  it("reuses the global root auth and remembered-workspace redirect contract", () => {
    useAuthRedirect.mockReturnValue("active");
    render(<WorkspaceRootPage />);

    expect(useAuthRedirect).toHaveBeenCalledWith("root");
    expect(useWorkspaceAutoResume).toHaveBeenCalledWith({
      enabled: true,
      redirectWhenEmpty: true,
    });
  });

  it("keeps the app-shell skeleton visible while the client redirect resolves", () => {
    useAuthRedirect.mockReturnValue("checking");
    render(<WorkspaceRootPage />);

    expect(screen.getByTestId("app-shell-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("sr-only");
    expect(useWorkspaceAutoResume).toHaveBeenCalledWith({
      enabled: false,
      redirectWhenEmpty: true,
    });
  });
});
