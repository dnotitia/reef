import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { LoginPanel } from "./LoginPanel";

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlTestProvider>{ui}</IntlTestProvider>
    </QueryClientProvider>,
  );
  return { queryClient };
}

function configResponse(enabled: boolean) {
  return new Response(
    JSON.stringify({
      keycloak: {
        enabled,
        login_url: enabled ? "/api/v1/auth/keycloak/login" : null,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("LoginPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockClear();
    refresh.mockClear();
  });

  it("keeps password fields usable while SSO config is loading", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );

    renderWithQueryClient(<LoginPanel redirectTo="/issues" />);

    expect(screen.getByTestId("sso-option-region")).toBeInTheDocument();
    expect(screen.getByTestId("sso-option-region")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.getByTestId("sso-config-loading")).toBeInTheDocument();
    expect(screen.getByTestId("login-username")).toBeInTheDocument();
    expect(screen.getByTestId("login-password")).toBeInTheDocument();
  });

  it("renders the workspace SSO action when Keycloak is enabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configResponse(true)));

    renderWithQueryClient(<LoginPanel redirectTo="/issues?status=open" />);

    const ssoLink = await screen.findByRole("link", {
      name: /continue with workspace sso/i,
    });
    expect(ssoLink).toHaveAttribute(
      "href",
      "/api/auth/akb/sso/start?redirect=%2Fissues%3Fstatus%3Dopen",
    );
    expect(
      screen.getByText((_, node) => {
        return (
          node?.tagName === "SPAN" &&
          node.textContent === "Use your akb-platform identity."
        );
      }),
    ).toBeVisible();
    for (const token of screen.getAllByText("akb-platform")) {
      expect(token).toHaveAttribute("translate", "no");
    }
    expect(screen.getByText("or use password")).toBeVisible();
  });

  it("falls back to password-only when SSO is disabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configResponse(false)));

    renderWithQueryClient(<LoginPanel />);

    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: /workspace sso/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Workspace identity")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sso-option-region")).not.toBeInTheDocument();
    expect(screen.getByTestId("login-username")).toBeInTheDocument();
  });

  it("falls back to password-only when config fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    renderWithQueryClient(<LoginPanel />);

    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: /workspace sso/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Workspace identity")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sso-option-region")).not.toBeInTheDocument();
    expect(screen.getByTestId("login-password")).toBeInTheDocument();
  });
});
