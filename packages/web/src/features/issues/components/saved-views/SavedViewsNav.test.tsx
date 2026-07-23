import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryState, mockRefetch, mockGetDefault, mockUpdate, mockRemove } =
  vi.hoisted(() => ({
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
    mockRefetch: vi.fn(),
    mockGetDefault: vi.fn(),
    mockUpdate: vi.fn(),
    mockRemove: vi.fn(),
  }));

vi.mock("@/features/issues/hooks/queries/useSavedIssueViews", () => ({
  useSavedIssueViews: () => ({ ...queryState, refetch: mockRefetch }),
}));

vi.mock("@/features/issues/hooks/mutations/useSavedIssueViewMutations", () => ({
  useUpdateSavedIssueView: () => ({
    mutateAsync: mockUpdate,
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
  useDeleteSavedIssueView: () => ({
    mutateAsync: mockRemove,
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock("@/lib/storage/config", () => ({
  getDefaultIssueViewId: mockGetDefault,
  clearDefaultIssueViewId: vi.fn(),
  setDefaultIssueViewId: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/reef-acme/issues",
  useSearchParams: () => new URLSearchParams("status=todo"),
}));

import { SavedViewsNav } from "./SavedViewsNav";

const savedView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "My todo",
  name_key: "my todo",
  owner: "alice",
  payload: { version: 1 as const, query: { status: ["todo"] } },
};

describe("SavedViewsNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.data = [savedView];
    queryState.isPending = false;
    queryState.isError = false;
    queryState.isSuccess = true;
    queryState.isFetching = false;
    mockGetDefault.mockResolvedValue(savedView.id);
  });

  it("renders a nested active link with an accessible default marker", async () => {
    render(
      <IntlTestProvider>
        <SavedViewsNav vault="reef-acme" />
      </IntlTestProvider>,
    );

    expect(
      await screen.findByRole("link", { name: "Default view My todo" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("saved-views-nav")).toHaveClass("ml-4");
  });

  it("keeps the sidebar geometry stable while loading", () => {
    queryState.data = undefined;
    queryState.isPending = true;
    queryState.isSuccess = false;

    render(
      <IntlTestProvider>
        <SavedViewsNav vault="reef-acme" />
      </IntlTestProvider>,
    );

    expect(screen.getByTestId("saved-views-loading")).toBeVisible();
    expect(screen.getAllByTestId("saved-view-skeleton")).toHaveLength(2);
  });

  it("shows a compact retry action after a list error", async () => {
    const user = userEvent.setup();
    queryState.data = undefined;
    queryState.isError = true;
    queryState.isSuccess = false;

    render(
      <IntlTestProvider>
        <SavedViewsNav vault="reef-acme" />
      </IntlTestProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Saved views couldn't load.",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockRefetch).toHaveBeenCalledOnce();
  });
});
