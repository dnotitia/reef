import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-acme",
    isLoading: false,
    refetch: () => Promise.resolve(),
  }),
}));

import { apiFetch } from "@/lib/apiClient";
import { ProjectSection } from "./ProjectSection";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("ProjectSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          config: { project_prefix: "REEF", monitored_repos: [] },
        }),
        { status: 200 },
      ),
    );
  });

  it("requests /api/config?vault={vault} via useProjectConfig", async () => {
    render(wrap(<ProjectSection />));
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith("/api/config?vault=reef-acme"),
    );
  });

  it("populates the input with the loaded project_prefix", async () => {
    render(wrap(<ProjectSection />));
    expect(await screen.findByDisplayValue("REEF")).toBeInTheDocument();
  });

  it("renders the prefix read-only (no input/save) when the viewer cannot edit", async () => {
    render(wrap(<ProjectSection canEdit={false} />));
    expect(
      await screen.findByTestId("project-prefix-readonly"),
    ).toHaveTextContent("REEF");
    expect(
      screen.queryByTestId("project-prefix-input"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-prefix-save")).not.toBeInTheDocument();
  });

  it("gives the prefix input an accessible name via the visible label (REEF-151)", async () => {
    render(wrap(<ProjectSection />));
    // aria-labelledby points at the visible "Project Prefix" text, so the
    // input has an accessible name without duplicating it in an aria-label.
    expect(
      await screen.findByRole("textbox", { name: "Project Prefix" }),
    ).toBeInTheDocument();
  });

  it("disables browser autofill/spellcheck on the prefix input (REEF-151)", async () => {
    render(wrap(<ProjectSection />));
    const input = await screen.findByTestId("project-prefix-input");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });
});
