import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIssueStore } from "../../stores/useIssueStore";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/reef-acme/issues",
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams("status=todo"),
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({ vault: "reef-acme", isLoading: false }),
}));

vi.mock("@/features/issues/hooks/mutations/useSavedIssueViewMutations", () => ({
  useCreateSavedIssueView: () => ({
    mutateAsync: mocks.mutateAsync,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { SaveIssueViewDialog } from "./SaveIssueViewDialog";

describe("SaveIssueViewDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useIssueStore.setState({
      filter: { status: ["todo"] },
      searchQuery: "",
      selectedIssueId: null,
    });
    mocks.mutateAsync.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Todo",
      name_key: "todo",
      owner: "alice",
      payload: { version: 1, query: { status: ["todo"] } },
    });
  });

  it("binds the returned row id to the current issue URL", async () => {
    const user = userEvent.setup();
    render(
      <IntlTestProvider>
        <SaveIssueViewDialog />
      </IntlTestProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Save view" }));
    await user.type(screen.getByLabelText("View name"), "Todo");
    await user.click(
      within(screen.getByTestId("save-view-dialog")).getByRole("button", {
        name: "Save view",
      }),
    );

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      name: "Todo",
      payload: { version: 1, query: { status: ["todo"] } },
    });
    expect(mocks.replace).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues?status=todo&saved_view=11111111-1111-4111-8111-111111111111",
      { scroll: false },
    );
  });
});
