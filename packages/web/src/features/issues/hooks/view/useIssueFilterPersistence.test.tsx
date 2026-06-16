// fake-indexeddb/auto should be imported first — the save hook writes to Dexie.
import "fake-indexeddb/auto";

import {
  getPersistedIssueFilter,
  setPersistedIssueFilter,
} from "@/lib/storage/config";
import { db } from "@/lib/storage/db";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useIssueStore } from "../../stores/useIssueStore";
import { useIssueFilterPersistence } from "./useIssueFilterPersistence";

/** A fresh, unmarked skip ref — user edits save normally. */
const noSkip = (): RefObject<boolean> => ({ current: false });

describe("useIssueFilterPersistence", () => {
  beforeEach(async () => {
    useIssueStore.setState({
      filter: {},
      filterVault: null,
      searchQuery: "",
      selectedIssueId: null,
    });
    await db.config.clear();
  });

  it("persists a filter change after the debounce window", async () => {
    renderHook(() => useIssueFilterPersistence("reef-acme", noSkip()));

    act(() => useIssueStore.getState().setFilter({ status: ["todo"] }));

    await waitFor(async () => {
      expect(await getPersistedIssueFilter("reef-acme")).toEqual({
        status: ["todo"],
      });
    });
  });

  it("persists a filter already active for the vault at mount (URL-applied)", async () => {
    // useIssueUrlSync applies a URL filter into the store before this hook's
    // subscription exists; mounting should persist it.
    useIssueStore.setState({
      filter: { status: ["closed"] },
      filterVault: "reef-acme",
      searchQuery: "",
      selectedIssueId: null,
    });
    renderHook(() => useIssueFilterPersistence("reef-acme", noSkip()));

    await waitFor(async () => {
      expect(await getPersistedIssueFilter("reef-acme")).toEqual({
        status: ["closed"],
      });
    });
  });

  it("does not wipe the saved slot when the store is empty at mount", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    useIssueStore.setState({
      filter: {},
      filterVault: "reef-acme",
      searchQuery: "",
      selectedIssueId: null,
    });
    renderHook(() => useIssueFilterPersistence("reef-acme", noSkip()));

    await new Promise((r) => setTimeout(r, 350));
    // An empty store at mount (restore pending / cleared) should not overwrite the
    // saved filter.
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({
      status: ["todo"],
    });
  });

  it("skips the restore's own marked write but saves the next user edit", async () => {
    const skip = noSkip();
    renderHook(() => useIssueFilterPersistence("reef-acme", skip));

    // Simulate the restore's own write: mark it, then change the filter.
    skip.current = true;
    act(() => useIssueStore.getState().setFilter({ status: ["todo"] }));
    await new Promise((r) => setTimeout(r, 350));
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});

    // A subsequent, unmarked user edit is persisted normally.
    act(() => useIssueStore.getState().setFilter({ priority: ["high"] }));
    await waitFor(async () => {
      expect(await getPersistedIssueFilter("reef-acme")).toEqual({
        status: ["todo"],
        priority: ["high"],
      });
    });
  });

  it("coalesces rapid changes into a single debounced write of the latest value", async () => {
    renderHook(() => useIssueFilterPersistence("reef-acme", noSkip()));

    act(() => {
      useIssueStore.getState().setFilter({ status: ["todo"] });
      useIssueStore.getState().setFilter({ status: ["in_progress"] });
      useIssueStore.getState().setFilter({ priority: ["high"] });
    });

    // Nothing written yet, well within the debounce window.
    await new Promise((r) => setTimeout(r, 50));
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});

    await waitFor(async () => {
      expect(await getPersistedIssueFilter("reef-acme")).toEqual({
        status: ["in_progress"],
        priority: ["high"],
      });
    });
  });

  it("ignores searchQuery and selectedIssueId changes (filter object unchanged)", async () => {
    renderHook(() => useIssueFilterPersistence("reef-acme", noSkip()));

    act(() => {
      useIssueStore.getState().setSearchQuery("auth");
      useIssueStore.getState().setSelectedIssueId("REEF-001");
    });

    await new Promise((r) => setTimeout(r, 350));
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});
  });

  it("persists only sort when the user clears filters (clearFiltersOnly)", async () => {
    useIssueStore.setState({
      filter: { status: ["todo"], sortField: "updated_at", sortOrder: "desc" },
      filterVault: null,
      searchQuery: "",
      selectedIssueId: null,
    });
    renderHook(() => useIssueFilterPersistence("reef-acme", noSkip()));

    act(() => useIssueStore.getState().clearFiltersOnly());

    await waitFor(async () => {
      expect(await getPersistedIssueFilter("reef-acme")).toEqual({
        sortField: "updated_at",
        sortOrder: "desc",
      });
    });
  });

  it("flushes a pending debounced save when unmounted before the timer fires", async () => {
    const { unmount } = renderHook(() =>
      useIssueFilterPersistence("reef-acme", noSkip()),
    );

    act(() => useIssueStore.getState().setFilter({ status: ["todo"] }));
    // Navigate away immediately — well within the 300ms debounce window.
    unmount();

    await waitFor(async () => {
      expect(await getPersistedIssueFilter("reef-acme")).toEqual({
        status: ["todo"],
      });
    });
  });

  it("scopes saves per vault", async () => {
    const skip = noSkip();
    const { rerender } = renderHook(
      ({ vault }) => useIssueFilterPersistence(vault, skip),
      { initialProps: { vault: "reef-acme" } },
    );

    act(() => useIssueStore.getState().setFilter({ status: ["todo"] }));
    await waitFor(async () => {
      expect(await getPersistedIssueFilter("reef-acme")).toEqual({
        status: ["todo"],
      });
    });

    rerender({ vault: "reef-zen" });
    act(() => useIssueStore.getState().setFilter({ priority: ["low"] }));
    await waitFor(async () => {
      expect(await getPersistedIssueFilter("reef-zen")).toEqual({
        status: ["todo"],
        priority: ["low"],
      });
    });
    // The first vault keeps its own slot — the second vault's write didn't leak.
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({
      status: ["todo"],
    });
  });
});
