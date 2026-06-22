// fake-indexeddb/auto is imported first because useIssueUrlSync restores the
// persisted filter from the Dexie config store.
import "fake-indexeddb/auto";

import { setPersistedIssueFilter } from "@/lib/storage/config";
import { db } from "@/lib/storage/db";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIssueStore } from "../../stores/useIssueStore";
import { useIssueUrlSync } from "./useIssueUrlSync";

const { mockPush, mockReplace, navigationState, vaultState } = vi.hoisted(
  () => {
    const navigationState = {
      pathname: "/issues",
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

function Harness() {
  useIssueUrlSync();
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
    navigationState.pathname = "/issues";
    navigationState.searchParams = new URLSearchParams();
    vaultState.value = "reef-acme";
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
        "/issues?assignee=alice&assignee=bob&sprint_id=s1",
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
        "/issues?status=todo&priority=high&q=auth",
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
      expect(mockPush).toHaveBeenCalledWith("/issues?status=todo", {
        scroll: false,
      });
    });
  });

  it("does not mirror filters onto the URL while a detail sheet is open", async () => {
    navigationState.pathname = "/issues/REEF-001";
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
    expect(pushedUrl.startsWith("/issues?")).toBe(true);
    expect(pushed.get("view")).toBe("list");
    expect(pushed.get("status")).toBe("todo");
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
        "/issues?status=in_review&sort=due_date&order=asc",
        { scroll: false },
      );
    });
    expect(mockPush).not.toHaveBeenCalled();
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
      expect(mockReplace).toHaveBeenCalledWith("/issues?status=todo", {
        scroll: false,
      });
    });
    mockReplace.mockClear();
    mockPush.mockClear();

    vaultState.value = "reef-zen";
    rerender(<Harness />);

    // The new vault's saved filter is restored; the stale-URL clear should not
    // abort the in-flight zen read (the restore effect intentionally does not
    // depend on searchParams, so its own clear-write does not re-run/abort it).
    await waitFor(() => {
      expect(useIssueStore.getState().filter.priority).toEqual(["low"]);
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/issues?priority=low", {
        scroll: false,
      });
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
    expect(mockReplace).toHaveBeenCalledWith("/issues?status=todo", {
      scroll: false,
    });
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
