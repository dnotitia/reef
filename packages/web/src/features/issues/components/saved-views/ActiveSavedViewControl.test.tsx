import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIssueStore } from "../../stores/useIssueStore";

const navigation = vi.hoisted(() => ({
  search: "status=todo&view=list",
}));

const queryState = vi.hoisted(() => ({
  data: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Alpha todo",
      name_key: "alpha todo",
      owner: "alice",
      payload: {
        version: 1 as const,
        query: { status: ["todo"], view: ["list"] },
      },
    },
  ],
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({ vault: "reef-acme", isLoading: false }),
}));

vi.mock("@/features/issues/hooks/queries/useSavedIssueViews", () => ({
  useSavedIssueViews: () => ({
    data: queryState.data,
    isSuccess: true,
    isFetching: false,
  }),
}));

vi.mock("@/features/issues/hooks/useSavedIssueViewPreferences", () => ({
  useSavedIssueViewPreferences: () => ({
    defaultId: undefined,
    favoriteIds: [],
    isLoading: false,
    setDefault: vi.fn(),
    setFavorite: vi.fn(),
  }),
}));

vi.mock("./SavedViewActions", () => ({
  SavedViewActions: ({
    triggerLabel,
    updatePayload,
  }: {
    triggerLabel?: string;
    updatePayload?: { query: Record<string, string[]> };
  }) => (
    <div>
      <button type="button" aria-label={triggerLabel}>
        Context
      </button>
      <output data-testid="update-payload">
        {JSON.stringify(updatePayload?.query)}
      </output>
    </div>
  ),
}));

import { ActiveSavedViewControl } from "./ActiveSavedViewControl";

describe("ActiveSavedViewControl", () => {
  beforeEach(() => {
    navigation.search = "status=todo&view=list";
    queryState.data = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Alpha todo",
        name_key: "alpha todo",
        owner: "alice",
        payload: {
          version: 1 as const,
          query: { status: ["todo"], view: ["list"] },
        },
      },
    ];
    useIssueStore.setState({
      filter: { status: ["todo"] },
      searchQuery: "",
      selectedIssueId: null,
    });
  });

  it("shows an exact saved view as active", () => {
    render(
      <IntlTestProvider>
        <ActiveSavedViewControl />
      </IntlTestProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Alpha todo, Active" }),
    ).toBeVisible();
  });

  it("retains context after filters diverge and exposes the current payload", () => {
    const { rerender } = render(
      <IntlTestProvider>
        <ActiveSavedViewControl />
      </IntlTestProvider>,
    );

    navigation.search = "priority=high&view=list";
    useIssueStore.setState({
      filter: { priority: ["high"] },
      searchQuery: "",
      selectedIssueId: null,
    });
    rerender(
      <IntlTestProvider>
        <ActiveSavedViewControl />
      </IntlTestProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Alpha todo, Changed" }),
    ).toBeVisible();
    expect(screen.getByTestId("update-payload")).toHaveTextContent(
      '{"priority":["high"],"view":["list"]}',
    );
  });

  it("binds actions to the selected row when payloads are identical", () => {
    const selected = {
      ...queryState.data[0],
      id: "22222222-2222-4222-8222-222222222222",
      name: "Another todo",
      name_key: "another todo",
    };
    queryState.data = [queryState.data[0], selected];
    navigation.search = `status=todo&view=list&saved_view=${selected.id}`;

    render(
      <IntlTestProvider>
        <ActiveSavedViewControl />
      </IntlTestProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Another todo, Active" }),
    ).toBeVisible();
  });

  it("restores a requested row as changed after a divergent URL reload", () => {
    const id = queryState.data[0].id;
    navigation.search = `priority=high&view=list&saved_view=${id}`;
    useIssueStore.setState({
      filter: { priority: ["high"] },
      searchQuery: "",
      selectedIssueId: null,
    });

    render(
      <IntlTestProvider>
        <ActiveSavedViewControl />
      </IntlTestProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Alpha todo, Changed" }),
    ).toBeVisible();
  });
});
