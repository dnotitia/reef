import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthScopedClientCache } from "@/lib/storage/clientCache";

const queryClientRef = vi.hoisted(() => ({
  current: undefined as QueryClient | undefined,
}));
import { QueryProvider } from "./QueryProvider";

function QueryClientConsumer() {
  const client = useQueryClient();
  queryClientRef.current = client;
  return (
    <div data-testid="has-client">{client ? "client-available" : "none"}</div>
  );
}

describe("QueryProvider", () => {
  beforeEach(() => {
    queryClientRef.current = undefined;
    window.localStorage.clear();
  });

  it("renders without crashing", () => {
    const { container } = render(
      <QueryProvider>
        <div>Hello</div>
      </QueryProvider>,
    );
    expect(container).toBeTruthy();
  });

  it("renders children", () => {
    render(
      <QueryProvider>
        <div data-testid="child">child content</div>
      </QueryProvider>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("useQueryClient() is accessible inside QueryProvider", () => {
    render(
      <QueryProvider>
        <QueryClientConsumer />
      </QueryProvider>,
    );
    expect(screen.getByTestId("has-client").textContent).toBe(
      "client-available",
    );
  });

  it("does not recreate an empty persisted snapshot after account cache cleanup", async () => {
    render(
      <QueryProvider>
        <QueryClientConsumer />
      </QueryProvider>,
    );

    await waitFor(() => expect(queryClientRef.current).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 25));

    act(() => {
      queryClientRef.current?.setQueryData(["account"], { id: "user-alice" });
    });
    await waitFor(
      () =>
        expect(
          window.localStorage.getItem("REACT_QUERY_OFFLINE_CACHE"),
        ).not.toBe(null),
      { timeout: 3_000 },
    );

    act(() => {
      clearAuthScopedClientCache();
    });

    await waitFor(
      () =>
        expect(window.localStorage.getItem("REACT_QUERY_OFFLINE_CACHE")).toBe(
          null,
        ),
      { timeout: 3_000 },
    );
  });
});
