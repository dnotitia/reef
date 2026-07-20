import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const reconcileAkbAccount = vi.fn();
const wipeAkbScopedBrowserState = vi.fn();
vi.mock("@/lib/akb/accountReconcile", () => ({
  reconcileAkbAccount: (id: string) => reconcileAkbAccount(id),
  wipeAkbScopedBrowserState: () => wipeAkbScopedBrowserState(),
}));

import { LoginForm } from "./LoginForm";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = makeQueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <IntlTestProvider>{ui}</IntlTestProvider>
    </QueryClientProvider>,
  );
  return { invalidateSpy, queryClient };
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByTestId("login-username"), "alice");
  await user.type(screen.getByTestId("login-password"), "pw");
  await user.click(screen.getByTestId("login-submit"));
}

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reconciles the AKB account, then navigates, on a successful sign-in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "user-1" } }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { invalidateSpy } = renderWithQueryClient(
      <LoginForm redirectTo="/issues" />,
    );
    await fillAndSubmit();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/akb/login",
      expect.objectContaining({ method: "POST" }),
    );
    expect(reconcileAkbAccount).toHaveBeenCalledWith("user-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["auth", "me"],
    });
    expect(push).toHaveBeenCalledWith("/issues");
  });

  it("keeps auth controls accessible before and during submit", async () => {
    let resolveLogin: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithQueryClient(<LoginForm />);

    expect(screen.getByTestId("login-submit")).toBeEnabled();
    expect(screen.getByTestId("login-username")).toHaveAttribute(
      "spellcheck",
      "false",
    );

    await fillAndSubmit();

    expect(screen.getByTestId("login-submit")).toBeDisabled();
    expect(screen.getByTestId("login-submit-spinner")).toBeInTheDocument();
    expect(screen.getByTestId("login-submit")).toHaveTextContent("Signing In…");

    resolveLogin(new Response(JSON.stringify({ user: { id: "user-1" } })));
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/");
    });
  });

  it("surfaces the backend error and does not reconcile on a failed sign-in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 401,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithQueryClient(<LoginForm />);
    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid username or password.",
    );
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "polite");
    expect(reconcileAkbAccount).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("wipes AKB-scoped browser state when login reports an account denial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Account suspended." }), {
          status: 403,
          headers: { "X-Reef-Auth-Invalidated": "1" },
        }),
      ),
    );

    renderWithQueryClient(<LoginForm />);
    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Account suspended.",
    );
    expect(wipeAkbScopedBrowserState).toHaveBeenCalledOnce();
    expect(reconcileAkbAccount).not.toHaveBeenCalled();
  });
});
