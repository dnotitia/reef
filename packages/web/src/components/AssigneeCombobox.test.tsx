import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import { AssigneeCombobox } from "./AssigneeCombobox";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("AssigneeCombobox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ users: [] }), { status: 200 }),
    );
  });

  it("renders a disabled combobox without fetching members when vault is empty", () => {
    render(
      wrap(<AssigneeCombobox value="alice" onChange={() => {}} vault="" />),
    );
    expect(screen.getByTestId("assignee-combobox")).toBeInTheDocument();
    expect(screen.getByLabelText("Assignee: alice")).toBeDisabled();
    // The member lookup should not fire without a vault. The current-user probe
    // behind the brand "this is you" avatar tone (REEF-173) is a separate,
    // app-wide cached concern, so assert specifically on the members endpoint.
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/vault-members"),
    );
  });

  it("renders the popover trigger when vault is provided", () => {
    render(
      wrap(
        <AssigneeCombobox
          value="alice"
          onChange={() => {}}
          vault="reef-acme"
        />,
      ),
    );
    expect(screen.getByTestId("assignee-combobox")).toBeInTheDocument();
    expect(screen.getByLabelText("Assignee: alice")).toBeInTheDocument();
  });

  it("renders placeholder when value is empty", () => {
    render(
      wrap(
        <AssigneeCombobox
          value=""
          onChange={() => {}}
          vault="reef-acme"
          placeholder="Pick someone"
        />,
      ),
    );
    expect(screen.getByText("Pick someone")).toBeInTheDocument();
  });

  it("falls back to <Input> when vault-members fetch fails", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );

    const { findByTestId } = render(
      wrap(
        <AssigneeCombobox
          value="alice"
          onChange={() => {}}
          vault="reef-acme"
        />,
      ),
    );

    expect(
      await findByTestId("assignee-combobox-fallback"),
    ).toBeInTheDocument();
  });

  it("widens the opened panel when panelClassName is set (REEF-134)", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <AssigneeCombobox
          value=""
          onChange={() => {}}
          vault="reef-acme"
          panelClassName="min-w-[17rem] max-w-[90vw]"
        />,
      ),
    );

    await user.click(screen.getByLabelText("Assignee"));

    // jsdom does not lay out pixels, so we does not assert visual truncation
    // directly. Assert the width *policy* instead: the opened user panel adopts
    // the supplied readable floor and sheds the default narrow min-width
    // (tailwind-merge keeps the later, caller-supplied token). This is the
    // structural contract that keeps long display names + @login readable.
    const panel = (await screen.findByRole("listbox")).parentElement;
    expect(panel?.className).toContain("min-w-[17rem]");
    expect(panel?.className).not.toContain("min-w-[12rem]");
    // Default anchoring stays right-aligned so dialog/report callers keep the
    // panel inside their clipped containers; the filter bar opts into "start".
    expect(panel?.className).toContain("right-0");
  });

  it("does not commit a stale user on Enter during the debounce window", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          users: [{ login: "alice", name: "Alice", avatar_url: null }],
        }),
        { status: 200 },
      ),
    );
    const onChange = vi.fn();
    render(
      wrap(<AssigneeCombobox value="" onChange={onChange} vault="reef-acme" />),
    );

    await user.click(screen.getByLabelText("Assignee"));
    // Empty-query lookup resolves → alice is selectable.
    expect(
      await screen.findByRole("option", { name: /Alice/ }),
    ).toBeInTheDocument();
    // Type a new query and press Enter before the 300ms debounce fires: the
    // visible options are still the previous result, so nothing should commit.
    await user.type(
      screen.getByPlaceholderText("Search members..."),
      "z{Enter}",
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
