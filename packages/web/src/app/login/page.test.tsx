import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { loadAkbAuthConfig } from "@/lib/akb/loadAkbAuthConfig";
import { loadAkbAuthV2Config } from "@/lib/akb/loadAkbAuthV2Config";
import type { AkbAuthV2Config } from "@reef/core";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/reef-mark", () => ({
  ReefMark: () => <div data-testid="reef-mark" />,
}));

vi.mock("@/features/auth/components/LoginPanel", () => ({
  LoginPanel: ({ redirectTo }: { redirectTo: string }) => (
    <div data-testid="login-panel">{redirectTo}</div>
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

vi.mock("@/lib/akb/loadAkbAuthV2Config", () => ({
  loadAkbAuthV2Config: vi.fn(),
}));

import LoginPage from "./page";

const loadAkbAuthConfigMock = vi.mocked(loadAkbAuthConfig);
const loadAkbAuthV2ConfigMock = vi.mocked(loadAkbAuthV2Config);

function ssoEnabledConfig(options: { ssoOnly?: boolean } = {}) {
  return {
    ok: true as const,
    config: {
      local_auth: { enabled: true },
      keycloak: {
        enabled: true,
        login_url: "/api/v1/auth/keycloak/login",
        sso_only: options.ssoOnly ?? false,
      },
    },
  };
}

describe("LoginPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    loadAkbAuthConfigMock.mockReset();
    loadAkbAuthV2ConfigMock.mockReset();
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

  it("passes a safe redirect target into the login panel", async () => {
    loadAkbAuthConfigMock.mockResolvedValue(ssoEnabledConfig());
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
    expect(screen.getByRole("heading", { name: "reef" })).toHaveAttribute(
      "translate",
      "no",
    );
  });

  describe("SSO-first auto-redirect (REEF-312)", () => {
    it("does not auto-redirect by default (env unset)", async () => {
      loadAkbAuthConfigMock.mockResolvedValue(ssoEnabledConfig());
      const view = await LoginPage({ searchParams: Promise.resolve({}) });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByTestId("login-panel")).toBeInTheDocument();
      expect(loadAkbAuthConfigMock).toHaveBeenCalledTimes(1);
    });

    it("redirects when AKB declares an SSO-only policy without an env override", async () => {
      loadAkbAuthConfigMock.mockResolvedValue(
        ssoEnabledConfig({ ssoOnly: true }),
      );

      await expect(
        LoginPage({ searchParams: Promise.resolve({ redirect: "/issues" }) }),
      ).rejects.toThrow("REDIRECT:/api/auth/akb/sso/start?redirect=%2Fissues");
    });

    it("redirects to SSO start, preserving the redirect destination", async () => {
      vi.stubEnv("REEF_SSO_AUTO_REDIRECT", "1");
      loadAkbAuthConfigMock.mockResolvedValue(ssoEnabledConfig());

      await expect(
        LoginPage({
          searchParams: Promise.resolve({ redirect: "/issues?status=open" }),
        }),
      ).rejects.toThrow(
        "REDIRECT:/api/auth/akb/sso/start?redirect=%2Fissues%3Fstatus%3Dopen",
      );
    });

    it("does not auto-redirect on an SSO error (loop guard)", async () => {
      vi.stubEnv("REEF_SSO_AUTO_REDIRECT", "1");
      loadAkbAuthConfigMock.mockResolvedValue(ssoEnabledConfig());

      const view = await LoginPage({
        searchParams: Promise.resolve({ sso_error: "exchange_failed" }),
      });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByRole("alert")).toBeInTheDocument();
      // The error short-circuits before any config probe.
      expect(loadAkbAuthConfigMock).not.toHaveBeenCalled();
    });

    it("does not auto-redirect on a legacy error (loop guard)", async () => {
      vi.stubEnv("REEF_SSO_AUTO_REDIRECT", "1");
      loadAkbAuthConfigMock.mockResolvedValue(ssoEnabledConfig());

      const view = await LoginPage({
        searchParams: Promise.resolve({ error: "expired" }),
      });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByTestId("login-panel")).toBeInTheDocument();
      expect(loadAkbAuthConfigMock).not.toHaveBeenCalled();
    });

    it("honors the password escape hatch (?password=1)", async () => {
      vi.stubEnv("REEF_SSO_AUTO_REDIRECT", "1");
      loadAkbAuthConfigMock.mockResolvedValue(ssoEnabledConfig());

      const view = await LoginPage({
        searchParams: Promise.resolve({ password: "1" }),
      });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByTestId("login-panel")).toBeInTheDocument();
      expect(loadAkbAuthConfigMock).not.toHaveBeenCalled();
    });

    it("honors the password escape hatch (?prompt=login)", async () => {
      vi.stubEnv("REEF_SSO_AUTO_REDIRECT", "1");
      loadAkbAuthConfigMock.mockResolvedValue(ssoEnabledConfig());

      const view = await LoginPage({
        searchParams: Promise.resolve({ prompt: "login" }),
      });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByTestId("login-panel")).toBeInTheDocument();
      expect(loadAkbAuthConfigMock).not.toHaveBeenCalled();
    });

    it("falls back to the panel when akb SSO is disabled", async () => {
      vi.stubEnv("REEF_SSO_AUTO_REDIRECT", "1");
      loadAkbAuthConfigMock.mockResolvedValue({
        ok: true,
        config: {
          local_auth: { enabled: true },
          keycloak: { enabled: false, login_url: null, sso_only: false },
        },
      });

      const view = await LoginPage({ searchParams: Promise.resolve({}) });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByTestId("login-panel")).toBeInTheDocument();
    });

    it("falls back to the panel when the backend is unreachable", async () => {
      vi.stubEnv("REEF_SSO_AUTO_REDIRECT", "1");
      loadAkbAuthConfigMock.mockResolvedValue({
        ok: false,
        reason: "backend_rejected",
      });

      const view = await LoginPage({ searchParams: Promise.resolve({}) });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByTestId("login-panel")).toBeInTheDocument();
    });
  });

  describe("future auth-v2 presentation", () => {
    const config: Extract<AkbAuthV2Config, { auth_mode: "sso" }> = {
      schema_version: 2,
      auth_mode: "sso",
      local_auth: { enabled: true },
      canonical_issuer: "https://identity.example.com/realms/reef",
      accepted_audiences: ["akb-api"],
      accepted_clients: ["reef-web"],
      token_validation: {
        algorithms: ["RS256"],
        access_token_type: "Bearer",
        provider_claim: "identity_provider",
      },
      account_validation: {
        endpoint: "/api/v2/auth/account-validation",
        credential: "bearer_access_token",
        requires_subject_binding: true,
        denial_codes: [
          "membership_required",
          "account_suspended",
          "identity_conflict",
        ],
      },
      keycloak: { enabled: true, browser_session_ready: true },
      providers: [
        {
          provider_type: "keycloak-oidc",
          alias: "workforce",
          display_name: "Company SSO",
        },
      ],
    };

    it("keeps hybrid panel by default and only redirects with explicit opt-in", async () => {
      vi.stubEnv("REEF_AUTH_V2_ENABLED", "1");
      loadAkbAuthV2ConfigMock.mockResolvedValue({ ok: true, config });

      const view = await LoginPage({
        searchParams: Promise.resolve({ redirect: "/issues" }),
      });
      render(<IntlTestProvider>{view}</IntlTestProvider>);
      expect(screen.getByTestId("login-panel")).toBeInTheDocument();

      vi.stubEnv("REEF_SSO_AUTO_REDIRECT", "1");
      await expect(
        LoginPage({ searchParams: Promise.resolve({ redirect: "/issues" }) }),
      ).rejects.toThrow(
        "REDIRECT:/api/auth/v2/start?provider=workforce&redirect=%2Fissues",
      );
    });
  });
});
