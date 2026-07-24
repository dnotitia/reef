import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryState, preferencesState, mockRefetch } = vi.hoisted(() => ({
  queryState: {
    data: undefined as
      | Array<{
          id: string;
          name: string;
          name_key: string;
          owner: string;
          payload: { version: 1; query: Record<string, string[]> };
        }>
      | undefined,
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
  },
  preferencesState: {
    defaultId: undefined as string | undefined,
    favoriteIds: [] as string[],
    isLoading: false,
    setDefault: vi.fn(),
    setFavorite: vi.fn(),
  },
  mockRefetch: vi.fn(),
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({ vault: "reef-acme", isLoading: false }),
}));

vi.mock("@/features/issues/hooks/queries/useSavedIssueViews", () => ({
  useSavedIssueViews: () => ({ ...queryState, refetch: mockRefetch }),
}));

vi.mock("@/features/issues/hooks/useSavedIssueViewPreferences", () => ({
  useSavedIssueViewPreferences: () => preferencesState,
}));

vi.mock("./SavedViewActions", () => ({
  SavedViewActions: ({ view }: { view: { name: string } }) => (
    <button type="button">{`Actions for ${view.name}`}</button>
  ),
}));

import { SavedViewsPage } from "./SavedViewsPage";

const savedView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "My todo",
  name_key: "my todo",
  owner: "alice",
  payload: { version: 1 as const, query: { status: ["todo"] } },
};

describe("SavedViewsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.data = [savedView];
    queryState.isPending = false;
    queryState.isError = false;
    queryState.isSuccess = true;
    queryState.isFetching = false;
    preferencesState.defaultId = savedView.id;
    preferencesState.favoriteIds = [savedView.id];
    preferencesState.isLoading = false;
  });

  it("shows every view as a real issue link with owner and personal indicators", () => {
    render(
      <IntlTestProvider>
        <SavedViewsPage />
      </IntlTestProvider>,
    );

    expect(screen.getByRole("heading", { name: "Views" })).toBeVisible();
    expect(screen.getByRole("link", { name: "My todo" })).toHaveAttribute(
      "href",
      `/workspace/reef-acme/issues?status=todo&saved_view=${savedView.id}`,
    );
    expect(screen.getByText("Owner: alice")).toBeVisible();
    expect(screen.getByText("Default view")).toBeVisible();
    expect(screen.getByText("Favorite")).toBeVisible();
  });

  it("provides an actual Issues link in the empty state", () => {
    queryState.data = [];
    render(
      <IntlTestProvider>
        <SavedViewsPage />
      </IntlTestProvider>,
    );

    expect(screen.getByText("No saved views yet")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Create a view in Issues" }),
    ).toHaveAttribute("href", "/workspace/reef-acme/issues");
  });

  it("offers retry after a list error", async () => {
    queryState.data = undefined;
    queryState.isError = true;
    queryState.isSuccess = false;
    render(
      <IntlTestProvider>
        <SavedViewsPage />
      </IntlTestProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockRefetch).toHaveBeenCalledOnce();
  });
});
