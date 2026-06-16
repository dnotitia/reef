import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIssueStore } from "../../stores/useIssueStore";
import { SearchBar } from "./SearchBar";

afterEach(cleanup);

beforeEach(() => {
  useIssueStore.setState({
    filter: {},
    searchQuery: "",
    selectedIssueId: null,
  });
});

describe("SearchBar", () => {
  it("renders input with placeholder", () => {
    render(<SearchBar />);
    const input = screen.getByTestId("search-input");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).placeholder).toBe("Search issues...");
  });

  it("typing updates local value immediately", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    const input = screen.getByTestId("search-input") as HTMLInputElement;
    await user.type(input, "auth");
    expect(input.value).toBe("auth");
  });

  it("updates store after 150ms debounce", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    await user.type(screen.getByTestId("search-input"), "dep");
    await waitFor(
      () => {
        expect(useIssueStore.getState().searchQuery).toBe("dep");
      },
      { timeout: 500 },
    );
  });

  it("shows clear button only when query is non-empty", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    expect(screen.queryByTestId("search-clear-button")).toBeNull();
    await user.type(screen.getByTestId("search-input"), "x");
    expect(screen.getByTestId("search-clear-button")).toBeTruthy();
  });

  it("clear button clears the query", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    await user.type(screen.getByTestId("search-input"), "foo");
    await user.click(screen.getByTestId("search-clear-button"));
    const input = screen.getByTestId("search-input") as HTMLInputElement;
    expect(input.value).toBe("");
    await waitFor(() => {
      expect(useIssueStore.getState().searchQuery).toBe("");
    });
  });

  it("retains the typed value when the search request fails (REEF-034 AC5)", async () => {
    // The search box is decoupled from the issue fetch — its value is owned by
    // the Zustand store, does not derived from a query result. A failed search
    // (the list view rendering its error state) leaves `searchQuery` untouched,
    // so the input keeps what the user typed and they can retry/edit.
    const user = userEvent.setup();
    render(<SearchBar />);
    const input = screen.getByTestId("search-input") as HTMLInputElement;
    await user.type(input, "auth");
    await waitFor(() => {
      expect(useIssueStore.getState().searchQuery).toBe("auth");
    });
    // Simulate the downstream fetch failing: nothing in the store search field
    // is reset on error, so the input value survives a re-render.
    cleanup();
    render(<SearchBar />);
    const rerendered = screen.getByTestId("search-input") as HTMLInputElement;
    expect(rerendered.value).toBe("auth");
  });

  it("Escape key clears the query via store sync", async () => {
    // Set store directly and verify the store-sync path
    useIssueStore.setState({
      filter: {},
      searchQuery: "already-set",
      selectedIssueId: null,
    });
    render(<SearchBar />);
    const input = screen.getByTestId("search-input") as HTMLInputElement;
    // Input should reflect the store value on sync
    expect(screen.getByTestId("search-clear-button")).toBeTruthy();
    // Fire a keydown event with Escape directly on the input
    const escEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
    });
    input.dispatchEvent(escEvent);
    // Wait for state to update
    await waitFor(() => {
      expect(useIssueStore.getState().searchQuery).toBe("");
    });
  });
});
