import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const reconcileAkbAccount = vi.fn();
vi.mock("@/lib/akb/accountReconcile", () => ({
  reconcileAkbAccount: (id: string) => reconcileAkbAccount(id),
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
    expect(reconcileAkbAccount).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
