import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: mockApiFetch,
  throwHttpError: vi.fn(async (response: Response) => {
    throw new Error(`HTTP ${response.status}`);
  }),
}));

import { ExistingWorkspaceOption } from "./ExistingWorkspaceOption";

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function renderOption(canManage = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <IntlTestProvider>
      <QueryClientProvider client={queryClient}>
        <ExistingWorkspaceOption
          vault="reef-current"
          initialStatus="blocked"
          canManage={canManage}
        />
      </QueryClientProvider>
    </IntlTestProvider>,
  );
}

describe("ExistingWorkspaceOption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(
      response({
        vaults: [
          {
            name: "reef-current",
            description: null,
            status: "active",
            role: "owner",
            created_at: null,
            installation_status: "ready",
          },
        ],
      }),
    );
  });

  it("keeps the row focused on impact, next step, owner and permitted actions", async () => {
    renderOption();

    const option = screen.getByTestId("workspace-installation-reef-current");
    expect(option).toHaveAttribute("data-status", "blocked");
    expect(option).toHaveTextContent(
      "People can't use this workspace right now.",
    );
    expect(option).toHaveTextContent(
      "An owner or admin can recheck status and contact the AKB installation operator.",
    );
    expect(option).toHaveTextContent("Workspace owner or admin");
    expect(screen.getByRole("button", { name: "Check status" })).toBeVisible();
    expect(
      screen.queryByTestId("installation-details"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/operator's checks/i)).not.toBeInTheDocument();
    expect(
      mockApiFetch.mock.calls.some(([url]) =>
        String(url).endsWith("/installation"),
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Check status" }));
    await waitFor(() => expect(option).toHaveAttribute("data-status", "ready"));
    expect(
      mockApiFetch.mock.calls.some(([url]) =>
        String(url).endsWith("/installation"),
      ),
    ).toBe(false);
  });

  it("shows owner guidance instead of leaking the underlying lifecycle to members", () => {
    renderOption(false);

    expect(
      screen.getByTestId("workspace-installation-reef-current"),
    ).toHaveAttribute("data-status", "management_required");
    expect(
      screen.getByText("Ask a workspace owner or admin to check the setup."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Restore installation" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check status" })).toBeVisible();
  });
});
