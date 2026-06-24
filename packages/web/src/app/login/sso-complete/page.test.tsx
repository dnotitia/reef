import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: navigation.refresh,
    replace: navigation.replace,
  }),
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@/components/ui/reef-mark", () => ({
  ReefMark: () => <div data-testid="reef-mark" />,
}));

const reconcileAkbAccount = vi.hoisted(() => vi.fn());

vi.mock("@/lib/akb/accountReconcile", () => ({
  reconcileAkbAccount: (id: string) => reconcileAkbAccount(id),
}));

import SsoCompletePage from "./page";

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <IntlTestProvider>{ui}</IntlTestProvider>
    </QueryClientProvider>,
  );
  return { invalidateSpy, queryClient };
}

describe("SsoCompletePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    navigation.refresh.mockClear();
    navigation.replace.mockClear();
    navigation.searchParams = new URLSearchParams();
    reconcileAkbAccount.mockClear();
  });

  it("reconciles the current AKB account before navigating to a safe next path", async () => {
    navigation.searchParams = new URLSearchParams({
      next: "/issues?status=open",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ user_id: "user-1" }), { status: 200 }),
        ),
    );

    const { invalidateSpy } = renderWithQueryClient(<SsoCompletePage />);

    expect(screen.getByText("Finishing sign-in...")).toBeInTheDocument();
    await waitFor(() => {
      expect(reconcileAkbAccount).toHaveBeenCalledWith("user-1");
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["auth", "me"],
    });
    expect(navigation.replace).toHaveBeenCalledWith("/issues?status=open");
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("normalizes unsafe next paths to root after reconcile", async () => {
    navigation.searchParams = new URLSearchParams({
      next: "https://evil.test/path",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "user-2" }), { status: 200 }),
        ),
    );

    renderWithQueryClient(<SsoCompletePage />);

    await waitFor(() => {
      expect(reconcileAkbAccount).toHaveBeenCalledWith("user-2");
    });
    expect(navigation.replace).toHaveBeenCalledWith("/");
  });

  it("accepts username-only AKB profiles during completion reconcile", async () => {
    navigation.searchParams = new URLSearchParams({ next: "/issues" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ username: "alice" }), { status: 200 }),
        ),
    );

    renderWithQueryClient(<SsoCompletePage />);

    await waitFor(() => {
      expect(reconcileAkbAccount).toHaveBeenCalledWith("alice");
    });
    expect(navigation.replace).toHaveBeenCalledWith("/issues");
  });

  it("redirects to a safe SSO error when profile verification fails", async () => {
    navigation.searchParams = new URLSearchParams({ next: "/issues" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );

    renderWithQueryClient(<SsoCompletePage />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        "/login?sso_error=completion_failed",
      );
    });
    expect(reconcileAkbAccount).not.toHaveBeenCalled();
  });
});
