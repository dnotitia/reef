import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SavedViewActions } from "./SavedViewActions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/features/issues/hooks/mutations/useSavedIssueViewMutations", () => ({
  useDeleteSavedIssueView: () => ({
    reset: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUpdateSavedIssueView: () => ({
    reset: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

describe("SavedViewActions", () => {
  it("uses the established action-menu width for both row and contextual triggers", async () => {
    const user = userEvent.setup();
    render(
      <IntlTestProvider>
        <SavedViewActions
          vault="reef-e2e"
          view={{
            id: "11111111-1111-4111-8111-111111111111",
            name: "Todo launch review",
            name_key: "todo launch review",
            owner: "alice",
            payload: {
              version: 1,
              query: { status: ["todo"], view: ["list"] },
            },
          }}
          preferences={{ defaultId: undefined, favoriteIds: [] }}
          setDefault={vi.fn()}
          setFavorite={vi.fn()}
          triggerLabel="Todo launch review, Changed"
          triggerContent={<span>Todo launch review</span>}
        />
      </IntlTestProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "Todo launch review, Changed" }),
    );

    expect(screen.getByRole("menu")).toHaveClass("w-56");
  });
});
