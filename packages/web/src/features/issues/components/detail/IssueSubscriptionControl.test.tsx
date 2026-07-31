import { apiFetch } from "@/lib/apiClient";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

import { IssueSubscriptionControl } from "./IssueSubscriptionControl";

const mockApiFetch = vi.mocked(apiFetch);
const mockToastError = vi.mocked(toast.error);

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function renderControl(queryClient = makeQueryClient()) {
  return render(
    <IssueSubscriptionControl issueId="REEF-001" vault="reef-e2e" />,
    { wrapper: wrapper(queryClient) },
  );
}

describe("IssueSubscriptionControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it.each([
    ["unwatched", "Watch"],
    ["watching", "Watching"],
    ["muted", "Muted"],
  ] as const)("renders %s as the accessible %s state", async (state, label) => {
    mockApiFetch.mockResolvedValueOnce(
      Response.json({ state }, { status: 200 }),
    );

    renderControl();

    expect(
      await screen.findByRole("button", {
        name: `Issue notifications: ${label}`,
      }),
    ).toHaveTextContent(label);
  });

  it("disables repeat interaction while a request is pending", async () => {
    const user = userEvent.setup();
    let resolveResponse: ((response: Response) => void) | undefined;
    mockApiFetch
      .mockResolvedValueOnce(
        Response.json({ state: "unwatched" }, { status: 200 }),
      )
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ state: "watching" }, { status: 200 }),
      );
    renderControl();
    const trigger = await screen.findByRole("button", {
      name: "Issue notifications: Watch",
    });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Watch" }));

    await waitFor(() => expect(trigger).toBeDisabled());
    expect(trigger).toHaveTextContent("Watching");
    expect(mockApiFetch).toHaveBeenCalledTimes(2);

    resolveResponse?.(Response.json({ state: "watching" }, { status: 200 }));
    await waitFor(() => expect(trigger).not.toBeDisabled());
  });

  it("rolls back and toasts when a state change fails", async () => {
    const user = userEvent.setup();
    mockApiFetch
      .mockResolvedValueOnce(
        Response.json({ state: "watching" }, { status: 200 }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: "Notification preference could not be changed." },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ state: "watching" }, { status: 200 }),
      );
    renderControl();
    const trigger = await screen.findByRole("button", {
      name: "Issue notifications: Watching",
    });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Mute" }));

    await waitFor(() => expect(trigger).toHaveTextContent("Watching"));
    expect(mockToastError).toHaveBeenCalledWith(
      "Notification preference could not be changed.",
    );
    expect(mockApiFetch).toHaveBeenCalledTimes(3);
  });
});
