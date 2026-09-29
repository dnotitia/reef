import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useAuthRedirect = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/hooks/useAuthRedirect", () => ({ useAuthRedirect }));
const useWorkspaceAutoResume = vi.hoisted(() =>
  vi.fn(() => ({
    status: "disabled" as
      | "disabled"
      | "pending"
      | "redirecting"
      | "empty"
      | "error",
    retry: vi.fn(),
  })),
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

  it.each(["pending", "redirecting"] as const)(
    "keeps the board app shell while workspace resume is %s",
    (status) => {
      useAuthRedirect.mockReturnValue("active");
      useWorkspaceAutoResume.mockReturnValue({ status, retry: vi.fn() });

      render(<WorkspaceRootPage />);

      expect(screen.getByTestId("app-shell-skeleton")).toBeInTheDocument();
      expect(screen.getByTestId("board-columns-skeleton")).toBeInTheDocument();
      expect(screen.queryByTestId("workspace-resume-loading")).toBeNull();
    },
  );

  it("keeps workspace resume errors and retry inside the app shell", () => {
    useAuthRedirect.mockReturnValue("active");
    const retry = vi.fn();
    useWorkspaceAutoResume.mockReturnValue({ status: "error", retry });

    render(<WorkspaceRootPage />);

    expect(screen.getByTestId("app-shell-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-resume-error")).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
