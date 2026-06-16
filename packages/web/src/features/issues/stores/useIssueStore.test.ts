// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { useIssueStore } from "./useIssueStore";

describe("useIssueStore", () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useIssueStore.setState({
      filter: {},
      searchQuery: "",
      selectedIssueId: null,
    });
  });

  it("initial state has empty filter and null selectedIssueId", () => {
    const filter = useIssueStore.getState().filter;
    const selectedId = useIssueStore.getState().selectedIssueId;
    expect(filter).toEqual({});
    expect(selectedId).toBeNull();
  });

  it("initial state has empty searchQuery", () => {
    const searchQuery = useIssueStore.getState().searchQuery;
    expect(searchQuery).toBe("");
  });

  it("setFilter merges partial filter into existing filter", () => {
    useIssueStore.getState().setFilter({ status: ["todo"] });
    expect(useIssueStore.getState().filter).toEqual({ status: ["todo"] });

    useIssueStore.getState().setFilter({ priority: ["high"] });
    expect(useIssueStore.getState().filter).toEqual({
      status: ["todo"],
      priority: ["high"],
    });
  });

  it("setFilter overwrites an existing field when the same key is provided", () => {
    useIssueStore.getState().setFilter({ status: ["todo"] });
    useIssueStore.getState().setFilter({ status: ["closed"] });
    expect(useIssueStore.getState().filter.status).toEqual(["closed"]);
  });

  it("clearFilter resets filter to empty object and clears searchQuery", () => {
    useIssueStore
      .getState()
      .setFilter({ status: ["todo"], priority: ["high"] });
    useIssueStore.getState().setSearchQuery("auth");
    useIssueStore.getState().clearFilter();
    expect(useIssueStore.getState().filter).toEqual({});
    expect(useIssueStore.getState().searchQuery).toBe("");
  });

  it("clearFiltersOnly clears filter/dependency but preserves sort and search", () => {
    useIssueStore.getState().setFilter({
      status: ["todo"],
      priority: ["high"],
      sortField: "created_at",
      sortOrder: "desc",
      dependencyFilter: ["blocked"],
    });
    useIssueStore.getState().setSearchQuery("auth");
    useIssueStore.getState().clearFiltersOnly();
    const filter = useIssueStore.getState().filter;
    expect(filter.status).toBeUndefined();
    expect(filter.priority).toBeUndefined();
    expect(filter.dependencyFilter).toBeUndefined();
    expect(filter.sortField).toBe("created_at");
    expect(filter.sortOrder).toBe("desc");
    // searchQuery is preserved (not cleared by clearFiltersOnly)
    expect(useIssueStore.getState().searchQuery).toBe("auth");
  });

  it("setSortField sets sortField in filter", () => {
    useIssueStore.getState().setSortField("updated_at");
    expect(useIssueStore.getState().filter.sortField).toBe("updated_at");
  });

  it("setSortField to undefined clears the sort field", () => {
    useIssueStore.getState().setSortField("created_at");
    useIssueStore.getState().setSortField(undefined);
    expect(useIssueStore.getState().filter.sortField).toBeUndefined();
  });

  it("setSortOrder sets sortOrder in filter", () => {
    useIssueStore.getState().setSortOrder("asc");
    expect(useIssueStore.getState().filter.sortOrder).toBe("asc");
  });

  it("setSortOrder to desc", () => {
    useIssueStore.getState().setSortOrder("desc");
    expect(useIssueStore.getState().filter.sortOrder).toBe("desc");
  });

  it("setFilter toggles dependencyFilter as a multi-select array (REEF-031)", () => {
    useIssueStore.getState().setFilter({ dependencyFilter: ["blocked"] });
    expect(useIssueStore.getState().filter.dependencyFilter).toEqual([
      "blocked",
    ]);

    useIssueStore
      .getState()
      .setFilter({ dependencyFilter: ["blocked", "blocking"] });
    expect(useIssueStore.getState().filter.dependencyFilter).toEqual([
      "blocked",
      "blocking",
    ]);

    useIssueStore.getState().setFilter({ dependencyFilter: undefined });
    expect(useIssueStore.getState().filter.dependencyFilter).toBeUndefined();
  });

  it("setSearchQuery updates searchQuery", () => {
    useIssueStore.getState().setSearchQuery("auth feature");
    expect(useIssueStore.getState().searchQuery).toBe("auth feature");
  });

  it("setSearchQuery with empty string clears query", () => {
    useIssueStore.getState().setSearchQuery("auth");
    useIssueStore.getState().setSearchQuery("");
    expect(useIssueStore.getState().searchQuery).toBe("");
  });

  it("setSelectedIssueId stores the issue id", () => {
    useIssueStore.getState().setSelectedIssueId("reef-042");
    expect(useIssueStore.getState().selectedIssueId).toBe("reef-042");
  });

  it("setSelectedIssueId with null clears the selection", () => {
    useIssueStore.getState().setSelectedIssueId("reef-042");
    useIssueStore.getState().setSelectedIssueId(null);
    expect(useIssueStore.getState().selectedIssueId).toBeNull();
  });

  it("granular selector: can select filter without subscribing to whole store", () => {
    useIssueStore.getState().setFilter({ status: ["todo"] });
    const filter = useIssueStore.getState().filter;
    expect(filter.status).toEqual(["todo"]);
  });

  it("granular selector: can select searchQuery independently", () => {
    useIssueStore.getState().setSearchQuery("dependency");
    const searchQuery = useIssueStore.getState().searchQuery;
    expect(searchQuery).toBe("dependency");
  });
});
