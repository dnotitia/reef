import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { loadAkbAuthConfig } from "@/lib/akb/loadAkbAuthConfig";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/reef-mark", () => ({
  ReefMark: () => <div data-testid="reef-mark" />,
}));

vi.mock("@/features/auth/components/LoginPanel", () => ({
  LoginPanel: ({
    authMode,
    redirectTo,
  }: {
    authMode: string | null;
    redirectTo: string;
  }) => (
    <div data-testid="login-panel" data-auth-mode={authMode ?? "invalid"}>
      {redirectTo}
    </div>
  ),
}));

// The real next/navigation redirect() throws to unwind rendering; mimic that so
// a test can assert the target path from the thrown error.
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

vi.mock("@/lib/akb/loadAkbAuthConfig", () => ({
  loadAkbAuthConfig: vi.fn(),
}));

import LoginPage from "./page";

const loadAkbAuthConfigMock = vi.mocked(loadAkbAuthConfig);

function localConfig(keycloakEnabled = false) {
  return {
    ok: true as const,
    config: {
      local_auth: { enabled: true },
      keycloak: {
        enabled: keycloakEnabled,
        login_url: keycloakEnabled ? "/api/v1/auth/keycloak/login" : null,
        sso_only: false,
      },
    },
  };
}

function versionedSsoConfig(providerCount = 1, localAuth = false) {
  return {
    ok: true as const,
    config: {
      schema_version: 2 as const,
      auth_mode: "sso" as const,
      local_auth: { enabled: localAuth },
      keycloak: { enabled: true, browser_session_ready: true },
      providers: Array.from({ length: providerCount }, (_, index) => ({
        provider_type: "keycloak-oidc" as const,
        alias: index === 0 ? "workforce" : `workforce-${index + 1}`,
        display_name: `Workforce ${index + 1}`,
        login_url: `/api/auth/akb/sso/start?provider=${index === 0 ? "workforce" : `workforce-${index + 1}`}`,
      })),
    },
  };
}

function configureSsoMode(): void {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("REEF_AUTH_MODE", "sso");
  vi.stubEnv(
    "REEF_KEYCLOAK_ISSUER",
    "https://identity.example.com/realms/reef",
  );
  vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
  vi.stubEnv("REEF_AKB_API_AUDIENCE", "akb-api");
  vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com");
}

describe("LoginPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    loadAkbAuthConfigMock.mockReset();
  });

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
      "SSO could not complete. Please try again.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("exchange_failed");
  });

  it.each([
    ["membership_required", /not.*member|workspace access/i],
    ["account_suspended", /suspended/i],
    ["identity_conflict", /identity/i],
  ] as const)("renders stable account SSO UX for %s", async (code, message) => {
    render(
      <IntlTestProvider>
        {
          await LoginPage({
            searchParams: Promise.resolve({ sso_error: code }),
          })
        }
      </IntlTestProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(message);
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

  it("passes a safe redirect target into the local login panel", async () => {
    loadAkbAuthConfigMock.mockResolvedValue(localConfig());
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
    expect(screen.getByTestId("login-panel")).toHaveAttribute(
      "data-auth-mode",
      "local",
    );
    expect(screen.getByRole("heading", { name: "reef" })).toHaveAttribute(
      "translate",
      "no",
    );
  });

  describe("mode-aware SSO auto-redirect", () => {
    it("does not follow a legacy delegated SSO catalog in local mode", async () => {
      loadAkbAuthConfigMock.mockResolvedValue(localConfig(true));

      const view = await LoginPage({ searchParams: Promise.resolve({}) });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByTestId("login-panel")).toHaveAttribute(
        "data-auth-mode",
        "local",
      );
    });

    it("starts Reef OIDC for the single versioned provider", async () => {
      configureSsoMode();
      loadAkbAuthConfigMock.mockResolvedValue(versionedSsoConfig());

      await expect(
        LoginPage({
          searchParams: Promise.resolve({ redirect: "/issues?status=open" }),
        }),
      ).rejects.toThrow(
        "REDIRECT:/api/auth/akb/sso/start?redirect=%2Fissues%3Fstatus%3Dopen&provider=workforce",
      );
    });

    it("keeps the hybrid panel for a single provider by default", async () => {
      configureSsoMode();
      loadAkbAuthConfigMock.mockResolvedValue(versionedSsoConfig(1, true));

      const view = await LoginPage({ searchParams: Promise.resolve({}) });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByTestId("login-panel")).toHaveAttribute(
        "data-auth-mode",
        "sso",
      );
    });

    it("honors the explicit SSO-first environment opt-in for hybrid auth", async () => {
      configureSsoMode();
      vi.stubEnv("REEF_SSO_AUTO_REDIRECT", "1");
      loadAkbAuthConfigMock.mockResolvedValue(versionedSsoConfig(1, true));

      await expect(
        LoginPage({ searchParams: Promise.resolve({}) }),
      ).rejects.toThrow("REDIRECT:/api/auth/akb/sso/start");
    });

    it("keeps the SSO panel for multiple provider choices", async () => {
      configureSsoMode();
      loadAkbAuthConfigMock.mockResolvedValue(versionedSsoConfig(2));

      const view = await LoginPage({ searchParams: Promise.resolve({}) });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByTestId("login-panel")).toHaveAttribute(
        "data-auth-mode",
        "sso",
      );
    });

    it.each([
      { sso_error: "sso_failed" },
      { error: "expired" },
      { password: "1" },
      { prompt: "login" },
    ])(
      "does not auto-loop for guarded query $sso_error$error$password$prompt",
      async (params) => {
        configureSsoMode();
        loadAkbAuthConfigMock.mockResolvedValue(versionedSsoConfig());

        const view = await LoginPage({ searchParams: Promise.resolve(params) });
        render(<IntlTestProvider>{view}</IntlTestProvider>);

        expect(screen.getByTestId("login-panel")).toBeInTheDocument();
        expect(loadAkbAuthConfigMock).not.toHaveBeenCalled();
      },
    );

    it("fails to the panel when the provider catalog is unreachable", async () => {
      configureSsoMode();
      loadAkbAuthConfigMock.mockResolvedValue({
        ok: false,
        reason: "backend_rejected",
      });

      const view = await LoginPage({ searchParams: Promise.resolve({}) });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByTestId("login-panel")).toHaveAttribute(
        "data-auth-mode",
        "sso",
      );
    });
  });
});
