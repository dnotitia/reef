import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  status: "checking" as "checking" | "active" | "inactive",
}));

vi.mock("@/features/auth/hooks/useAuthRedirect", () => ({
  useAuthRedirect: () => authState.status,
}));
vi.mock("@/features/onboarding/components/OnboardingPanel", () => ({
  OnboardingPanel: () => <div data-testid="onboarding-panel" />,
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
  });

  it.each(["checking", "inactive"] as const)(
    "does not expose account controls while auth is %s",
    (status) => {
      authState.status = status;

      render(<OnboardingClient appVersion="0.10.0" />);

      expect(
        screen.queryByTestId("onboarding-account-menu"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("onboarding-panel")).not.toBeInTheDocument();
    },
  );

  it("keeps the account utility mounted after the session is active", () => {
    authState.status = "active";

    render(<OnboardingClient appVersion="0.10.0" />);

    expect(screen.getByTestId("onboarding-account-control")).toHaveAttribute(
      "data-version",
      "0.10.0",
    );
    expect(screen.getByTestId("onboarding-panel")).toBeInTheDocument();
  });
});
