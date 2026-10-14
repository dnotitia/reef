import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { clearAuthScopedClientCache } from "@/lib/storage/clientCache";

const queryClientRef = vi.hoisted(() => ({
  current: undefined as QueryClient | undefined,
}));
import { QueryProvider } from "./QueryProvider";

function QueryClientConsumer() {
  const client = useQueryClient();
  useEffect(() => {
    queryClientRef.current = client;
  }, [client]);
  return (
    <div data-testid="has-client">{client ? "client-available" : "none"}</div>
  );
}

describe("QueryProvider", () => {
  beforeEach(() => {
    queryClientRef.current = undefined;
    window.localStorage.clear();
  });

  afterEach(() => vi.useRealTimers());

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
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await act(async () => {
      render(
        <QueryProvider>
          <QueryClientConsumer />
        </QueryProvider>,
      );
    });
    const client = queryClientRef.current;
    expect(client).toBeDefined();
    if (!client) throw new Error("expected mounted QueryClient");

    await act(async () => {
      client.setQueryData(["account"], { id: "user-alice" });
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(window.localStorage.getItem("REACT_QUERY_OFFLINE_CACHE")).toContain(
      "user-alice",
    );

    await act(async () => {
      clearAuthScopedClientCache();
      // Drain the real persister's 1000ms throttle after QueryCache removal.
      await vi.advanceTimersByTimeAsync(1_001);
    });
    expect(client.getQueryData(["account"])).toBeUndefined();
    expect(window.localStorage.getItem("REACT_QUERY_OFFLINE_CACHE")).toBeNull();
  });
});
