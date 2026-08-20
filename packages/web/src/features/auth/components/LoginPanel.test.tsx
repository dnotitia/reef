import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, refresh, replace, searchParamsState } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  searchParamsState: { value: "" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace }),
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
}));

import {
  consumePendingAkbAccountErrorIfUnchanged,
  recordAkbAccountDenial,
  snapshotPendingAkbAccountError,
  subscribeAkbAccountDenied,
} from "@/lib/akb/accountDenialClient";
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

function expectLatestDenialRedirect(expected: Record<string, string>) {
  const target = replace.mock.calls.at(-1)?.[0];
  expect(typeof target).toBe("string");
  const url = new URL(target as string, "https://reef.test");
  expect(url.pathname).toBe("/login");
  for (const [key, value] of Object.entries(expected)) {
    expect(url.searchParams.get(key)).toBe(value);
  }
  expect(url.searchParams.get("sso_error_token")).toMatch(/^[0-9a-f-]{36}$/);
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
    searchParamsState.value = "";
    sessionStorage.clear();
  });

  it("preserves redirect and password query state when restoring a denial", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configResponse(false)));
    searchParamsState.value = "redirect=%2Fissues&password=1";
    recordAkbAccountDenial("membership_required");

    renderWithQueryClient(<LoginPanel redirectTo="/issues" />);

    await waitFor(() =>
      expectLatestDenialRedirect({
        redirect: "/issues",
        password: "1",
        sso_error: "membership_required",
      }),
    );
  });

  it("preserves a pending denial when the URL has no ordering token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configResponse(false)));
    searchParamsState.value = "sso_error=account_suspended&redirect=%2Fissues";
    recordAkbAccountDenial("membership_required");

    renderWithQueryClient(<LoginPanel redirectTo="/issues" />);

    await waitFor(() =>
      expectLatestDenialRedirect({
        sso_error: "membership_required",
        redirect: "/issues",
      }),
    );
  });

  it("restores a pending account-denial query after a late plain-login redirect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configResponse(false)));
    recordAkbAccountDenial("membership_required");

    renderWithQueryClient(<LoginPanel />);

    await waitFor(() =>
      expectLatestDenialRedirect({ sso_error: "membership_required" }),
    );
  });

  it("adds ordering provenance to a matching un-tokenized denial URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    searchParamsState.value = "sso_error=membership_required";
    recordAkbAccountDenial("membership_required");

    renderWithQueryClient(<LoginPanel />);

    await waitFor(() =>
      expectLatestDenialRedirect({ sso_error: "membership_required" }),
    );
  });

  it("restores a denial recorded after the login panel mounts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configResponse(false)));

    renderWithQueryClient(<LoginPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("login-username")).toBeVisible(),
    );

    act(() => recordAkbAccountDenial("membership_required"));

    await waitFor(() =>
      expectLatestDenialRedirect({ sso_error: "membership_required" }),
    );
  });

  it("replaces an older URL denial when a newer live denial arrives", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configResponse(false)));
    searchParamsState.value = "sso_error=account_suspended&redirect=%2Fissues";

    renderWithQueryClient(<LoginPanel redirectTo="/issues" />);
    await waitFor(() =>
      expect(screen.getByTestId("login-username")).toBeVisible(),
    );

    act(() => recordAkbAccountDenial("membership_required"));

    await waitFor(() =>
      expectLatestDenialRedirect({
        sso_error: "membership_required",
        redirect: "/issues",
      }),
    );
  });

  it("restores a newer pending denial recorded during login navigation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configResponse(false)));
    recordAkbAccountDenial("account_suspended");
    const olderToken = snapshotPendingAkbAccountError()?.token;
    expect(olderToken).toBeDefined();
    searchParamsState.value = `sso_error=account_suspended&sso_error_token=${olderToken}`;
    recordAkbAccountDenial("membership_required");

    renderWithQueryClient(<LoginPanel redirectTo="/issues" />);

    await waitFor(() =>
      expectLatestDenialRedirect({ sso_error: "membership_required" }),
    );
  });

  it("restores pending state when a URL pairs its token with the wrong code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    recordAkbAccountDenial("membership_required");
    const token = snapshotPendingAkbAccountError()?.token;
    expect(token).toBeDefined();
    searchParamsState.value = `sso_error=account_suspended&sso_error_token=${token}`;

    renderWithQueryClient(<LoginPanel />);

    await waitFor(() =>
      expectLatestDenialRedirect({ sso_error: "membership_required" }),
    );
  });

  it("clears a tokenized denial URL after a successful probe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    recordAkbAccountDenial("membership_required");
    const snapshot = snapshotPendingAkbAccountError();
    expect(snapshot).toBeDefined();
    searchParamsState.value = `redirect=%2Fissues&sso_error=membership_required&sso_error_token=${snapshot?.token}`;

    renderWithQueryClient(<LoginPanel redirectTo="/issues" />);
    expect(snapshotPendingAkbAccountError()).toEqual(snapshot);
    replace.mockClear();

    act(() => consumePendingAkbAccountErrorIfUnchanged(snapshot));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/login?redirect=%2Fissues"),
    );
  });

  it("clears a denial while its tokenized URL replacement is still pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    recordAkbAccountDenial("membership_required");
    const snapshot = snapshotPendingAkbAccountError();

    renderWithQueryClient(<LoginPanel />);
    await waitFor(() =>
      expectLatestDenialRedirect({ sso_error: "membership_required" }),
    );
    replace.mockClear();

    act(() => consumePendingAkbAccountErrorIfUnchanged(snapshot));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("clears a tokenized denial URL when its pending record is already gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(configResponse(false)));
    recordAkbAccountDenial("membership_required");
    const snapshot = snapshotPendingAkbAccountError();
    consumePendingAkbAccountErrorIfUnchanged(snapshot);
    searchParamsState.value = `redirect=%2Fissues&sso_error=membership_required&sso_error_token=${snapshot?.token}`;

    renderWithQueryClient(<LoginPanel redirectTo="/issues" />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/login?redirect=%2Fissues"),
    );
  });

  it("keeps a live denial authoritative when storage cannot replace stale state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    recordAkbAccountDenial("membership_required");
    const stale = snapshotPendingAkbAccountError();
    searchParamsState.value = `sso_error=membership_required&sso_error_token=${stale?.token}`;
    renderWithQueryClient(<LoginPanel />);
    replace.mockClear();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    act(() => recordAkbAccountDenial("account_suspended"));

    await waitFor(() =>
      expectLatestDenialRedirect({ sso_error: "account_suspended" }),
    );
    const liveSnapshot = snapshotPendingAkbAccountError();
    expect(liveSnapshot).toEqual(
      expect.objectContaining({ code: "account_suspended" }),
    );
    consumePendingAkbAccountErrorIfUnchanged(liveSnapshot);
  });

  it("keeps a tokenized live denial authoritative after cross-navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    recordAkbAccountDenial("membership_required");
    let liveToken: string | undefined;
    const unsubscribe = subscribeAkbAccountDenied((_code, snapshot) => {
      liveToken = snapshot?.token;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    recordAkbAccountDenial("account_suspended");
    unsubscribe();
    expect(liveToken).toBeDefined();
    searchParamsState.value = `sso_error=account_suspended&sso_error_token=${liveToken}`;

    renderWithQueryClient(<LoginPanel />);

    const liveSnapshot = snapshotPendingAkbAccountError();
    expect(liveSnapshot).toEqual({
      code: "account_suspended",
      token: liveToken,
    });
    expect(replace).not.toHaveBeenCalled();
    consumePendingAkbAccountErrorIfUnchanged(liveSnapshot);
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
