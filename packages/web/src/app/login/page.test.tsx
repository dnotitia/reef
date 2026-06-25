import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { loadAkbAuthConfig } from "@/lib/akb/loadAkbAuthConfig";
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

import LoginPage from "./page";

const loadAkbAuthConfigMock = vi.mocked(loadAkbAuthConfig);

function ssoEnabledConfig() {
  return {
    ok: true as const,
    config: {
      keycloak: { enabled: true, login_url: "/api/v1/auth/keycloak/login" },
    },
  };
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

  describe("SSO-first auto-redirect (REEF-312)", () => {
    it("does not auto-redirect by default (env unset)", async () => {
      const view = await LoginPage({ searchParams: Promise.resolve({}) });
      render(<IntlTestProvider>{view}</IntlTestProvider>);

      expect(screen.getByTestId("login-panel")).toBeInTheDocument();
      expect(loadAkbAuthConfigMock).not.toHaveBeenCalled();
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
        config: { keycloak: { enabled: false, login_url: null } },
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
});
