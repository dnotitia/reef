import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  status: "checking" as "checking" | "active" | "inactive",
}));
const resumeState = vi.hoisted(() => ({
  status: "disabled" as
    | "disabled"
    | "pending"
    | "redirecting"
    | "empty"
    | "error",
  retry: vi.fn(),
}));

vi.mock("@/features/auth/hooks/useAuthRedirect", () => ({
  useAuthRedirect: () => authState.status,
}));
vi.mock("@/features/onboarding/components/OnboardingPanel", () => ({
  OnboardingPanel: () => <div data-testid="onboarding-panel" />,
}));
vi.mock("@/features/onboarding/hooks/useWorkspaceAutoResume", () => ({
  useWorkspaceAutoResume: () => resumeState,
}));
vi.mock("@/features/auth/components/AccountMenu", () => ({
  AccountMenu: ({ appVersion }: { appVersion: string }) => (
    <div data-testid="onboarding-account-control" data-version={appVersion} />
  ),
}));

import { OnboardingClient } from "./OnboardingClient";

describe("OnboardingClient authentication boundary", () => {
  beforeEach(() => {
    authState.status = "checking";
    resumeState.status = "disabled";
    resumeState.retry.mockReset();
  });

  it.each(["checking", "inactive"] as const)(
    "does not expose account controls while auth is %s",
    (status) => {
      authState.status = status;

      render(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />);

      expect(
        screen.queryByTestId("onboarding-account-menu"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("onboarding-panel")).not.toBeInTheDocument();
    },
  );

  it("keeps the account utility mounted after the session is active", () => {
    authState.status = "active";

    resumeState.status = "empty";
    render(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />);

    expect(screen.getByTestId("onboarding-account-control")).toHaveAttribute(
      "data-version",
      "0.10.0",
    );
    expect(screen.getByTestId("onboarding-panel")).toBeInTheDocument();
  });

  it.each(["pending", "redirecting"] as const)(
    "keeps the board shell while workspace resume is %s",
    (status) => {
      authState.status = "active";
      resumeState.status = status;

      render(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />);

      expect(screen.getByTestId("app-shell-skeleton")).toBeInTheDocument();
      expect(screen.getByTestId("board-columns-skeleton")).toBeInTheDocument();
      expect(screen.queryByTestId("workspace-resume-loading")).toBeNull();
      expect(screen.queryByTestId("onboarding-page")).toBeNull();
    },
  );

  it("keeps retryable workspace errors inside the app shell", () => {
    authState.status = "active";
    resumeState.status = "error";

    render(<OnboardingClient appVersion="0.10.0" pageSubtitle="Welcome" />);

    expect(screen.getByTestId("app-shell-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-resume-error")).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(resumeState.retry).toHaveBeenCalledOnce();
  });
});
