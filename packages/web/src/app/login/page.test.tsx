import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/reef-mark", () => ({
  ReefMark: () => <div data-testid="reef-mark" />,
}));

vi.mock("@/features/auth/components/LoginPanel", () => ({
  LoginPanel: ({ redirectTo }: { redirectTo: string }) => (
    <div data-testid="login-panel">{redirectTo}</div>
  ),
}));

import LoginPage from "./page";

describe("LoginPage", () => {
  it("renders a PM-friendly SSO error without backend details", async () => {
    render(
      <IntlTestProvider>
        {
          await LoginPage({
            searchParams: Promise.resolve({ sso_error: "exchange_failed" }),
          })
        }
      </IntlTestProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "SSO could not complete. Try again or use password.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("exchange_failed");
  });

  it("keeps the older session-ended message", async () => {
    render(
      <IntlTestProvider>
        {
          await LoginPage({
            searchParams: Promise.resolve({ error: "expired" }),
          })
        }
      </IntlTestProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your previous session has ended. Please sign in again.",
    );
  });

  it("passes a safe redirect target into the login panel", async () => {
    render(
      <IntlTestProvider>
        {
          await LoginPage({
            searchParams: Promise.resolve({
              redirect: "/issues?status=open",
            }),
          })
        }
      </IntlTestProvider>,
    );

    expect(screen.getByTestId("login-panel")).toHaveTextContent(
      "/issues?status=open",
    );
  });
});
