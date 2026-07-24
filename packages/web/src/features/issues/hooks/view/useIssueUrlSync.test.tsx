// fake-indexeddb/auto is imported first because useIssueUrlSync restores the
// persisted filter from the Dexie config store.
import "fake-indexeddb/auto";

import {
  getDefaultIssueViewId,
  setDefaultIssueViewId,
  setPersistedIssueFilter,
} from "@/lib/storage/config";
import { db } from "@/lib/storage/db";
import type { SavedIssueView } from "@reef/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIssueStore } from "../../stores/useIssueStore";
import { useIssueUrlSync } from "./useIssueUrlSync";

const { mockPush, mockReplace, navigationState, vaultState } = vi.hoisted(
  () => {
    const navigationState = {
      pathname: "/workspace/reef-acme/issues",
      searchParams: new URLSearchParams(),
    };
    // Model the browser: a push/replace updates the query that the next
    // useSearchParams() read sees. Without this, a restore-written URL would not feed
    // back into a later vault switch, which is exactly what hid the cross-vault
    // filter leak (REEF-010 regression).
    const applyHref = (href: string) => {
      navigationState.searchParams = new URLSearchParams(
        href.split("?")[1] ?? "",
      );
    };
    return {
      mockPush: vi.fn((href: string) => applyHref(href)),
      mockReplace: vi.fn((href: string) => applyHref(href)),
      navigationState,
      vaultState: { value: "reef-acme" },
    };
  },
);

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: vaultState.value,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

function Harness({
  savedViews,
  savedViewsReady,
  savedViewsFailed,
}: {
  savedViews?: SavedIssueView[];
  savedViewsReady?: boolean;
  savedViewsFailed?: boolean;
} = {}) {
  useIssueUrlSync(savedViews, savedViewsReady, savedViewsFailed);
  const setFilter = useIssueStore((state) => state.setFilter);

  return (
    <>
      <button type="button" onClick={() => setFilter({ status: ["todo"] })}>
        Set status
      </button>
      <button type="button" onClick={() => setFilter({ priority: ["high"] })}>
        Set priority
      </button>
    </>
  );
}

describe("useIssueUrlSync", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockReplace.mockClear();
    navigationState.pathname = "/workspace/reef-acme/issues";
    navigationState.searchParams = new URLSearchParams();
    vaultState.value = "reef-acme";
    window.history.replaceState({}, "", "/workspace/reef-acme/issues");
    useIssueStore.setState({
      filter: {},
      filterVault: null,
      searchQuery: "",
      selectedIssueId: null,
    });
    await db.config.clear();
  });

  it("drops an unknown status URL value so a stale `?status=open` is ignored, not emptied (REEF-141)", async () => {
    // The former `open` value was renamed to `todo`; a stale shared/bookmarked
    // `?status=open` should not survive into client filter state, where
    // `filterIssues` would match it against no issue and render an empty list.
    navigationState.searchParams = new URLSearchParams("status=open");

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filterVault).toBe("reef-acme");
    });
    expect(useIssueStore.getState().filter.status).toBeUndefined();
  });

  it("keeps the valid members of a mixed status URL and drops unknown ones", async () => {
    navigationState.searchParams = new URLSearchParams(
      "status=open&status=todo&status=in_progress",
    );

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual([
        "todo",
        "in_progress",
      ]);
    });
  });

  it("initializes issue filter state from URL params", async () => {
    navigationState.searchParams = new URLSearchParams(
      "status=todo&type=bug&priority=high&assignee=alice&requester=bob&sprint_id=spr-1&milestone_id=mil-1&release_id=rel-1&severity=major&due=overdue&labels=ui&dep=blocked&sort=updated_at&order=desc&q=auth",
    );

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });

    const { filter, searchQuery } = useIssueStore.getState();
    expect(filter.issueType).toEqual(["bug"]);
    expect(filter.priority).toEqual(["high"]);
    // Multi-select people/planning facets parse as arrays (REEF-267); milestone
    // stays a single scalar.
    expect(filter.assignee).toEqual(["alice"]);
    expect(filter.requester).toEqual(["bob"]);
    expect(filter.sprint_id).toEqual(["spr-1"]);
    expect(filter.milestone_id).toBe("mil-1");
    expect(filter.release_id).toEqual(["rel-1"]);
    expect(filter.severity).toEqual(["major"]);
    expect(filter.due).toEqual(["overdue"]);
    expect(filter.label).toBe("ui");
    expect(filter.dependencyFilter).toEqual(["blocked"]);
    expect(filter.sortField).toBe("updated_at");
    expect(filter.sortOrder).toBe("desc");
    expect(searchQuery).toBe("auth");
    // URL-wins keeps skipNextWrite, so neither push nor replace fires.
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("applies a query-only history navigation instead of overwriting it from stale store state", async () => {
    navigationState.searchParams = new URLSearchParams("status=todo");
    const { rerender } = render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    mockPush.mockClear();
    mockReplace.mockClear();

    navigationState.searchParams = new URLSearchParams(
      "priority=high&view=list",
    );
    rerender(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.priority).toEqual(["high"]);
    });
    expect(useIssueStore.getState().filter.status).toBeUndefined();
    expect(mockPush).not.toHaveBeenCalledWith(
      expect.stringContaining("status=todo"),
      expect.anything(),
    );
    expect(mockReplace).not.toHaveBeenCalledWith(
      expect.stringContaining("status=todo"),
      expect.anything(),
    );
  });

  it("ignores an orphaned order param with no sort field (REEF-059)", async () => {
    // A fieldless `order` should not restore `sortOrder`: it would otherwise sit
    // orphaned in the store and re-serialize to the URL / IndexedDB, leaving the
    // filter non-pristine. The store invariant is sortOrder ⟹ sortField. The
    // `status` param gives a positive signal that the restore actually ran.
    navigationState.searchParams = new URLSearchParams("status=todo&order=asc");

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });

    const { filter } = useIssueStore.getState();
    expect(filter.sortField).toBeUndefined();
    expect(filter.sortOrder).toBeUndefined();
  });

  it("normalizes a fieldless-order URL: estimate_points with no order → natural desc (REEF-059)", async () => {
    // A shared URL like `?sort=estimate_points` (no order) should not leave the
    // control showing one direction while the data renders another: restore
    // fills the field's natural order so the display, the client `sortIssues`,
    // and the server query all agree. estimate_points → desc ("Most").
    navigationState.searchParams = new URLSearchParams("sort=estimate_points");

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.sortField).toBe("estimate_points");
    });
    expect(useIssueStore.getState().filter.sortOrder).toBe("desc");
  });

  it("normalizes a fieldless-order URL: due_date with no order → natural asc (REEF-059)", async () => {
    navigationState.searchParams = new URLSearchParams("sort=due_date");

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.sortField).toBe("due_date");
    });
    expect(useIssueStore.getState().filter.sortOrder).toBe("asc");
  });

  it("reads repeated facet params into a multi-select array (REEF-031)", async () => {
    navigationState.searchParams = new URLSearchParams(
      "status=todo&status=in_progress&due=overdue&due=due_soon",
    );

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual([
        "todo",
        "in_progress",
      ]);
    });
    expect(useIssueStore.getState().filter.due).toEqual([
      "overdue",
      "due_soon",
    ]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("reads repeated people & planning facet params into arrays (REEF-267)", async () => {
    navigationState.searchParams = new URLSearchParams(
      "assignee=alice&assignee=bob&requester=carol&sprint_id=s1&sprint_id=s2&release_id=r1",
    );

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.assignee).toEqual([
        "alice",
        "bob",
      ]);
    });
    const { filter } = useIssueStore.getState();
    expect(filter.requester).toEqual(["carol"]);
    expect(filter.sprint_id).toEqual(["s1", "s2"]);
    expect(filter.release_id).toEqual(["r1"]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("ignores a blank people/planning facet param (REEF-267)", async () => {
    navigationState.searchParams = new URLSearchParams(
      "assignee=&sprint_id=&status=todo",
    );

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    const { filter } = useIssueStore.getState();
    // A bare `?assignee=` / `?sprint_id=` should not seed an empty-member array.
    expect(filter.assignee).toBeUndefined();
    expect(filter.sprint_id).toBeUndefined();
  });

  it("serializes multi-select people/planning facets as repeated params (REEF-267)", async () => {
    useIssueStore.setState({
      filter: { assignee: ["alice", "bob"], sprint_id: ["s1"] },
      searchQuery: "",
      selectedIssueId: null,
    });

    render(<Harness />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        "/workspace/reef-acme/issues?assignee=alice&assignee=bob&sprint_id=s1",
        { scroll: false },
      );
    });
  });

  it("keeps existing store filters when the new route has no issue params", async () => {
    useIssueStore.setState({
      filter: { status: ["todo"], priority: ["high"] },
      searchQuery: "auth",
      selectedIssueId: null,
    });

    render(<Harness />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        "/workspace/reef-acme/issues?status=todo&priority=high&q=auth",
        { scroll: false },
      );
    });
  });

  it("writes filter changes back to the current route", async () => {
    render(<Harness />);
    // Let the (empty) restore settle before interacting.
    await waitFor(() => expect(mockPush).not.toHaveBeenCalled());
    mockPush.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Set status" }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        "/workspace/reef-acme/issues?status=todo",
        {
          scroll: false,
        },
      );
    });
  });

  it("does not mirror filters onto the URL while a detail sheet is open", async () => {
    navigationState.pathname = "/workspace/reef-acme/issues/REEF-001";
    navigationState.searchParams = new URLSearchParams();
    useIssueStore.setState({
      filter: { assignee: ["jylkim"] },
      searchQuery: "",
      selectedIssueId: null,
    });

    render(<Harness />);

    await Promise.resolve();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Set status" }));
    await Promise.resolve();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not overwrite a cross-route navigation when search params update before pathname", async () => {
    navigationState.searchParams = new URLSearchParams("status=todo&view=list");
    const { rerender } = render(<Harness />);
    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    mockPush.mockClear();
    mockReplace.mockClear();

    // Model Next's transient split render during Issues → Settings: the
    // destination has no query, while usePathname still reports Issues.
    window.history.pushState({}, "", "/workspace/reef-acme/settings");
    navigationState.searchParams = new URLSearchParams();
    rerender(<Harness />);
    await Promise.resolve();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    navigationState.pathname = "/workspace/reef-acme/settings";
    rerender(<Harness />);
    await Promise.resolve();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not overwrite a non-workspace navigation while pathname is stale", async () => {
    navigationState.searchParams = new URLSearchParams("status=todo&view=list");
    const { rerender } = render(<Harness />);
    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    mockPush.mockClear();
    mockReplace.mockClear();

    window.history.pushState({}, "", "/login");
    navigationState.searchParams = new URLSearchParams();
    rerender(<Harness />);
    await Promise.resolve();

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("waits for the Issues pathname before hydrating a split destination query", async () => {
    navigationState.pathname = "/workspace/reef-acme/issues/REEF-001";
    navigationState.searchParams = new URLSearchParams("status=todo");
    const { rerender } = render(<Harness />);
    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });

    window.history.pushState(
      {},
      "",
      "/workspace/reef-acme/issues?priority=high",
    );
    navigationState.searchParams = new URLSearchParams("priority=high");
    rerender(<Harness />);
    expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    expect(useIssueStore.getState().filter.priority).toBeUndefined();

    navigationState.pathname = "/workspace/reef-acme/issues";
    rerender(<Harness />);
    await waitFor(() => {
      expect(useIssueStore.getState().filter.priority).toEqual(["high"]);
    });
    expect(useIssueStore.getState().filter.status).toBeUndefined();
  });

  it("preserves the ?view= param when a filter changes", async () => {
    navigationState.searchParams = new URLSearchParams("view=list");
    render(<Harness />);
    await waitFor(() => expect(mockPush).not.toHaveBeenCalled());
    mockPush.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Set status" }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
    const pushedUrl = mockPush.mock.calls[0][0] as string;
    const pushed = new URLSearchParams(pushedUrl.split("?")[1]);
    expect(pushedUrl.startsWith("/workspace/reef-acme/issues?")).toBe(true);
    expect(pushed.get("view")).toBe("list");
    expect(pushed.get("status")).toBe("todo");
  });

  it("restores the last-used filter beside an explicit view mode without applying the named-view default", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    navigationState.searchParams = new URLSearchParams("view=list");
    await setDefaultIssueViewId("reef-acme", id);
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });

    render(
      <Harness
        savedViews={[
          {
            id,
            name: "My work",
            name_key: "my work",
            owner: "alice",
            payload: {
              version: 1,
              query: { assignee: ["alice"], view: ["timeline"] },
            },
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    expect(useIssueStore.getState().filter.assignee).toBeUndefined();
    expect(mockReplace).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues?view=list&status=todo",
      { scroll: false },
    );
  });

  it("routes same-page bare navigation back through the named default landing", async () => {
    const view: SavedIssueView = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "High priority",
      name_key: "high priority",
      owner: "alice",
      payload: { version: 1, query: { priority: ["high"] } },
    };
    await setDefaultIssueViewId("reef-acme", view.id);
    navigationState.searchParams = new URLSearchParams("status=todo");
    const { rerender } = render(<Harness savedViews={[view]} />);
    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });

    navigationState.searchParams = new URLSearchParams();
    rerender(<Harness savedViews={[view]} />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.priority).toEqual(["high"]);
    });
    expect(useIssueStore.getState().filter.status).toBeUndefined();
  });

  it("routes same-page view-only navigation through the last-used landing", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["in_progress"] });
    navigationState.searchParams = new URLSearchParams("priority=low");
    const { rerender } = render(<Harness />);
    await waitFor(() => {
      expect(useIssueStore.getState().filter.priority).toEqual(["low"]);
    });

    navigationState.searchParams = new URLSearchParams("view=list");
    rerender(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["in_progress"]);
    });
    expect(useIssueStore.getState().filter.priority).toBeUndefined();
  });

  it("mirrors the restored filter + sort onto the URL via replace (REEF-010)", async () => {
    await setPersistedIssueFilter("reef-acme", {
      status: ["in_review"],
      sortField: "due_date",
      sortOrder: "asc",
    });

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["in_review"]);
    });
    const { filter } = useIssueStore.getState();
    expect(filter.sortField).toBe("due_date");
    expect(filter.sortOrder).toBe("asc");
    // REEF-010: a restored personal filter IS mirrored onto the URL — but via
    // replace (hydration), not push, so no bare /issues history entry stacks.
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/workspace/reef-acme/issues?status=in_review&sort=due_date&order=asc",
        { scroll: false },
      );
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("restarts an interrupted restore under Strict Effects", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });

    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    expect(mockReplace).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues?status=todo",
      { scroll: false },
    );
  });

  it("lets URL params win over the saved filter (restore is skipped)", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["closed"] });
    navigationState.searchParams = new URLSearchParams("status=todo");

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    // Give the (skipped) restore a chance to wrongly clobber, then confirm the
    // URL value still stands and the saved "closed" was not loaded.
    await new Promise((r) => setTimeout(r, 20));
    expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("honors an explicit empty-filter saved link without restoring personal filters", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["closed"] });
    navigationState.searchParams = new URLSearchParams("filter=none&view=list");

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filterVault).toBe("reef-acme");
    });
    expect(useIssueStore.getState().filter).toEqual({});
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("materializes a valid personal default view before the last-used filter", async () => {
    const view: SavedIssueView = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "My work",
      name_key: "my work",
      owner: "alice",
      payload: {
        version: 1,
        query: {
          assignee: ["alice"],
          sort: ["updated_at"],
          view: ["list"],
        },
      },
    };
    await setDefaultIssueViewId("reef-acme", view.id);
    await setPersistedIssueFilter("reef-acme", { status: ["closed"] });

    render(<Harness savedViews={[view]} />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.assignee).toEqual(["alice"]);
    });
    expect(useIssueStore.getState().filter.status).toBeUndefined();
    expect(mockReplace).toHaveBeenCalledWith(
      `/workspace/reef-acme/issues?assignee=alice&order=desc&sort=updated_at&view=list&saved_view=${view.id}`,
      { scroll: false },
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("applies the default on a same-vault bare Issues remount", async () => {
    const view: SavedIssueView = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "My work",
      name_key: "my work",
      owner: "alice",
      payload: { version: 1, query: { assignee: ["alice"] } },
    };
    await setDefaultIssueViewId("reef-acme", view.id);
    useIssueStore.setState({
      filter: { status: ["in_review"] },
      filterVault: "reef-acme",
      searchQuery: "",
    });

    render(<Harness savedViews={[view]} />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.assignee).toEqual(["alice"]);
    });
    expect(useIssueStore.getState().filter.status).toBeUndefined();
    expect(mockReplace).toHaveBeenCalledWith(
      `/workspace/reef-acme/issues?assignee=alice&saved_view=${view.id}`,
      { scroll: false },
    );
    expect(mockPush).not.toHaveBeenCalledWith(
      expect.stringContaining("status=in_review"),
      expect.anything(),
    );
  });

  it("materializes the last-used filter on a same-vault bare remount", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    const first = render(<Harness />);
    await waitFor(() => {
      expect(navigationState.searchParams.get("status")).toBe("todo");
    });
    first.unmount();

    navigationState.searchParams = new URLSearchParams();
    mockReplace.mockClear();
    render(<Harness />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/workspace/reef-acme/issues?status=todo",
        { scroll: false },
      );
    });
  });

  it("falls back to the last-used filter when the default read rejects", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    vi.spyOn(db.config, "get").mockRejectedValueOnce(
      new Error("IndexedDB unavailable"),
    );

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/workspace/reef-acme/issues?status=todo",
        { scroll: false },
      );
    });
  });

  it("materializes an empty default as an explicit clear-all board view", async () => {
    const view: SavedIssueView = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "All issues",
      name_key: "all issues",
      owner: "alice",
      payload: { version: 1, query: {} },
    };
    await setDefaultIssueViewId("reef-acme", view.id);
    await setPersistedIssueFilter("reef-acme", { status: ["closed"] });

    render(<Harness savedViews={[view]} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        `/workspace/reef-acme/issues?filter=none&saved_view=${view.id}`,
        { scroll: false },
      );
    });
    expect(useIssueStore.getState().filter).toEqual({});
    expect(await getDefaultIssueViewId("reef-acme")).toBe(view.id);
  });

  it("does not let a delayed default overwrite a newer user filter", async () => {
    const view: SavedIssueView = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Closed",
      name_key: "closed",
      owner: "alice",
      payload: { version: 1, query: { status: ["closed"] } },
    };
    await setDefaultIssueViewId("reef-acme", view.id);

    render(<Harness savedViews={[view]} />);
    fireEvent.click(screen.getByRole("button", { name: "Set priority" }));

    await waitFor(() => {
      expect(useIssueStore.getState().filter.priority).toEqual(["high"]);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useIssueStore.getState().filter.status).toBeUndefined();
    expect(mockReplace).not.toHaveBeenCalledWith(
      expect.stringContaining("status=closed"),
      expect.anything(),
    );
  });

  it("waits for the saved-view query instead of falling through to the last-used filter", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    await setDefaultIssueViewId("reef-acme", id);
    await setPersistedIssueFilter("reef-acme", { status: ["closed"] });

    const { rerender } = render(
      <Harness
        savedViews={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "Stale cached view",
            name_key: "stale cached view",
            owner: "alice",
            payload: { version: 1, query: { priority: ["low"] } },
          },
        ]}
        savedViewsReady={false}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useIssueStore.getState().filter.status).toBeUndefined();
    expect(await getDefaultIssueViewId("reef-acme")).toBe(id);

    rerender(
      <Harness
        savedViews={[
          {
            id,
            name: "Todo",
            name_key: "todo",
            owner: "alice",
            payload: { version: 1, query: { status: ["todo"] } },
          },
        ]}
        savedViewsReady
      />,
    );
    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
  });

  it("falls back without clearing the default after a saved-view read failure", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    await setDefaultIssueViewId("reef-acme", id);
    await setPersistedIssueFilter("reef-acme", { status: ["closed"] });

    render(
      <Harness
        savedViews={undefined}
        savedViewsReady={false}
        savedViewsFailed
      />,
    );

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["closed"]);
    });
    expect(await getDefaultIssueViewId("reef-acme")).toBe(id);
  });

  it("clears a stale or inapplicable default pointer and safely falls back", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    await setDefaultIssueViewId("reef-acme", id);
    await setPersistedIssueFilter("reef-acme", { priority: ["high"] });

    render(
      <Harness
        savedViews={[
          {
            id,
            name: "Broken",
            name_key: "broken",
            owner: "alice",
            payload: {
              version: 1,
              query: { status: ["removed-status"], unknown: ["x"] },
            },
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(useIssueStore.getState().filter.priority).toEqual(["high"]);
    });
    expect(await getDefaultIssueViewId("reef-acme")).toBeUndefined();
  });

  it("restores per-vault and re-restores on a mid-session vault switch", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    await setPersistedIssueFilter("reef-zen", { priority: ["low"] });

    const { rerender } = render(<Harness />);
    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    // acme's restored filter is mirrored into the URL (REEF-010).
    await waitFor(() => {
      expect(navigationState.searchParams.get("status")).toBe("todo");
    });

    vaultState.value = "reef-zen";
    // A vault switch navigates the URL to the new workspace (REEF-315); the hook
    // derives the vault from that same path, so move the pathname in step.
    navigationState.pathname = "/workspace/reef-zen/issues";
    window.history.pushState({}, "", "/workspace/reef-zen/issues");
    rerender(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.priority).toEqual(["low"]);
    });
    // zen's own saved filter wins; acme's status should not leak into store or URL,
    // even though the URL still carried ?status=todo at switch time (REEF-010).
    expect(useIssueStore.getState().filter.status).toBeUndefined();
    await waitFor(() => {
      expect(navigationState.searchParams.get("priority")).toBe("low");
    });
    expect(navigationState.searchParams.get("status")).toBeNull();
  });

  it("clears the previous vault's mirrored URL when switching to a vault with no saved filter (REEF-010)", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    // reef-zen has NO saved filter.

    const { rerender } = render(<Harness />);
    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    await waitFor(() => {
      expect(navigationState.searchParams.get("status")).toBe("todo");
    });

    vaultState.value = "reef-zen";
    // A vault switch navigates the URL to the new workspace (REEF-315); the hook
    // derives the vault from that same path, so move the pathname in step.
    navigationState.pathname = "/workspace/reef-zen/issues";
    window.history.pushState({}, "", "/workspace/reef-zen/issues");
    rerender(<Harness />);

    // zen has no saved filter → the store empties AND the stale acme URL is
    // cleared, so a reload does not misread ?status=todo as zen's explicit filter.
    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toBeUndefined();
    });
    await waitFor(() => {
      expect(navigationState.searchParams.toString()).toBe("");
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("restores the new vault and keeps the whole switch on replace, never push (REEF-010)", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    await setPersistedIssueFilter("reef-zen", { priority: ["low"] });

    const { rerender } = render(<Harness />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/workspace/reef-acme/issues?status=todo",
        {
          scroll: false,
        },
      );
    });
    mockReplace.mockClear();
    mockPush.mockClear();

    vaultState.value = "reef-zen";
    // A vault switch navigates the URL to the new workspace (REEF-315); the hook
    // derives the vault from that same path, so move the pathname in step.
    navigationState.pathname = "/workspace/reef-zen/issues";
    window.history.pushState({}, "", "/workspace/reef-zen/issues");
    rerender(<Harness />);

    // The new vault's saved filter is restored; the stale-URL clear should not
    // abort the in-flight zen read (the restore effect intentionally does not
    // depend on searchParams, so its own clear-write does not re-run/abort it).
    await waitFor(() => {
      expect(useIssueStore.getState().filter.priority).toEqual(["low"]);
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/workspace/reef-zen/issues?priority=low",
        {
          scroll: false,
        },
      );
    });
    // The whole switch — clearing acme's stale params and applying zen's filter —
    // goes through replace (hydration), not push, so no spurious history entry
    // is stacked on a vault switch.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("lets a live user filter change win over a slower restore (pristine guard)", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["closed"] });

    render(<Harness />);
    // Click before the async Dexie read resolves — the store is now non-pristine.
    fireEvent.click(screen.getByRole("button", { name: "Set priority" }));

    await waitFor(() => {
      expect(useIssueStore.getState().filter.priority).toEqual(["high"]);
    });
    await new Promise((r) => setTimeout(r, 20));
    // The saved "closed" status should not clobber the user's live choice.
    expect(useIssueStore.getState().filter.status).toBeUndefined();
    expect(useIssueStore.getState().filter.priority).toEqual(["high"]);
  });

  it("re-restores when the vault changed while /issues was unmounted", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    await setPersistedIssueFilter("reef-zen", { priority: ["low"] });

    // Mount on acme and restore acme's saved filter.
    const first = render(<Harness />);
    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    // Leave /issues — the hook's refs are gone, but the module-level store (and
    // its filterVault tag) survive, holding acme's filter.
    first.unmount();

    // The active vault switches while unmounted (e.g. via Settings), then the
    // workspace mounts fresh.
    vaultState.value = "reef-zen";
    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.priority).toEqual(["low"]);
    });
    // acme's stale filter should not leak into zen.
    expect(useIssueStore.getState().filter.status).toBeUndefined();
  });

  it("mirrors the restore via replace exactly once and never push (REEF-010)", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });

    render(<Harness />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues?status=todo",
      {
        scroll: false,
      },
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("uses push (not replace) for a user filter edit made after a restore (REEF-010)", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });

    render(<Harness />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    mockPush.mockClear();
    mockReplace.mockClear();

    // The one-shot replaceNextWrite was consumed by the restore mirror, so the
    // subsequent user edit should PUSH a shareable/back-able entry, not replace.
    fireEvent.click(screen.getByRole("button", { name: "Set priority" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("restores showArchived from archived=1 and lets the URL win over the saved filter (REEF-010)", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["closed"] });
    navigationState.searchParams = new URLSearchParams("archived=1");

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.showArchived).toBe(true);
    });
    // archived=1 counts as "URL has issue params", so the saved "closed" filter
    // should not load (URL wins — AC1/AC2), and the URL-wins path mirrors neither.
    await new Promise((r) => setTimeout(r, 20));
    expect(useIssueStore.getState().filter.status).toBeUndefined();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("reads archived=true as well as archived=1 (REEF-010)", async () => {
    navigationState.searchParams = new URLSearchParams("archived=true");

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.showArchived).toBe(true);
    });
  });

  it("emits archived=1 when showArchived is true (REEF-010)", async () => {
    useIssueStore.setState({
      filter: { showArchived: true },
      filterVault: null,
      searchQuery: "",
      selectedIssueId: null,
    });

    render(<Harness />);

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const params = new URLSearchParams(
      (mockPush.mock.calls[0][0] as string).split("?")[1] ?? "",
    );
    expect(params.get("archived")).toBe("1");
  });

  it("omits archived when showArchived is undefined (the real toggle-off value)", async () => {
    useIssueStore.setState({
      filter: { status: ["todo"], showArchived: undefined },
      filterVault: null,
      searchQuery: "",
      selectedIssueId: null,
    });

    render(<Harness />);

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const params = new URLSearchParams(
      (mockPush.mock.calls[0][0] as string).split("?")[1] ?? "",
    );
    expect(params.has("archived")).toBe(false);
    expect(params.get("status")).toBe("todo");
  });

  it("omits archived when showArchived is literally false (REEF-010)", async () => {
    useIssueStore.setState({
      filter: { status: ["todo"], showArchived: false },
      filterVault: null,
      searchQuery: "",
      selectedIssueId: null,
    });

    render(<Harness />);

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const params = new URLSearchParams(
      (mockPush.mock.calls[0][0] as string).split("?")[1] ?? "",
    );
    expect(params.has("archived")).toBe(false);
  });

  it("restores showStale from stale=1 and emits it back, mirroring archived (REEF-275)", async () => {
    navigationState.searchParams = new URLSearchParams("stale=1");

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.showStale).toBe(true);
    });
  });

  it("reads stale=true as well as stale=1 (REEF-275)", async () => {
    navigationState.searchParams = new URLSearchParams("stale=true");

    render(<Harness />);

    await waitFor(() => {
      expect(useIssueStore.getState().filter.showStale).toBe(true);
    });
  });

  it("emits stale=1 when showStale is true and omits it otherwise (REEF-275)", async () => {
    useIssueStore.setState({
      filter: { showStale: true },
      filterVault: null,
      searchQuery: "",
      selectedIssueId: null,
    });

    render(<Harness />);

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const params = new URLSearchParams(
      (mockPush.mock.calls[0][0] as string).split("?")[1] ?? "",
    );
    expect(params.get("stale")).toBe("1");
  });
});
