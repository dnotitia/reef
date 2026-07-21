import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace }),
  useSearchParams: () => new URLSearchParams(),
}));

import { recordAkbAccountDenial } from "@/lib/akb/accountDenialClient";
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

function configResponse(
  enabled: boolean,
  options: { localAuth?: boolean; ssoOnly?: boolean } = {},
) {
  return new Response(
    JSON.stringify({
      local_auth: { enabled: options.localAuth ?? true },
      keycloak: {
        enabled,
        login_url: enabled ? "/api/v1/auth/keycloak/login" : null,
        sso_only: options.ssoOnly ?? false,
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
    replace.mockClear();
    sessionStorage.clear();
  });

  it("restores a pending account-denial query after a late plain-login redirect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configResponse(false)));
    recordAkbAccountDenial("membership_required");

    renderWithQueryClient(<LoginPanel />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "/login?sso_error=membership_required",
      ),
    );
  });

  it("does not flash password fields while auth policy is loading", () => {
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
    expect(screen.queryByTestId("login-username")).not.toBeInTheDocument();
    expect(screen.queryByTestId("login-password")).not.toBeInTheDocument();
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

  it("hides the password escape when AKB disables local auth", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          configResponse(true, { localAuth: false, ssoOnly: true }),
        ),
    );

    renderWithQueryClient(<LoginPanel redirectTo="/issues" />);

    expect(
      await screen.findByRole("link", { name: /continue with workspace sso/i }),
    ).toBeVisible();
    expect(screen.queryByTestId("login-username")).not.toBeInTheDocument();
    expect(screen.queryByTestId("login-password")).not.toBeInTheDocument();
    expect(screen.queryByText("or use password")).not.toBeInTheDocument();
  });

  it("shows an unavailable state when AKB exposes no login method", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(configResponse(false, { localAuth: false })),
    );

    renderWithQueryClient(<LoginPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no sign-in method is available/i,
    );
    expect(screen.queryByTestId("login-password")).not.toBeInTheDocument();
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
