import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// These tests drive a 150ms search debounce with real timers, so each assertion
// waits a debounce interval (plus a state flush) for results. Raise the async
// query timeout above the 1s default so a slow/contended CI box does not flake them;
// it stays under vitest's 5s test timeout. (Vitest isolates modules per file, so
// this does not leak to other suites.)
configure({ asyncUtilTimeout: 3000 });

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-acme",
    isLoading: false,
    refetch: () => Promise.resolve(),
  }),
}));

// The palette no longer filters a cached list client-side; it asks the server
// for the recent set (empty box) or the `q` match set (typed query). The mock
// answers from a fixed corpus the same way the akb adapter would, so the test
// exercises the wiring (debounced `q`, recent fallback, archived exclusion) and
// the loading/error branches.
const useIssueListMock = vi.fn();
vi.mock("@/features/issues/hooks/queries/useIssueList", () => ({
  useIssueList: (...args: unknown[]) => useIssueListMock(...args),
}));

// The exact-id by-id probe. Inert by default (no id resolved); the truncation
// test drives it to return a specific issue.
const useExactIssueMock = vi.fn();
vi.mock("../hooks/useExactIssue", () => ({
  useExactIssue: (...args: unknown[]) => useExactIssueMock(...args),
}));

vi.mock("@/features/issues/hooks/queries/useIssueRelations", () => ({
  useIssueRelations: () => ({ data: [] }),
}));

import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { useGlobalSearchStore } from "../stores/useGlobalSearchStore";
import { GlobalSearchDialog } from "./GlobalSearchDialog";

function makeIssue(
  id: string,
  title: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    title,
    status: "todo",
    created_at: "2026-04-13T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-04-13T00:00:00.000Z",
    updated_by: "alice",
    ...extra,
  };
}

// The server already excludes archived rows, so the corpus the mock returns
// holds active issues; REEF-003 (archived) is not returned.
const CORPUS = [
  makeIssue("REEF-001", "Fix login bug"),
  makeIssue("REEF-002", "Add settings page"),
];

type ListResult = { data?: unknown; isLoading?: boolean; isError?: boolean };

/** Default mock: recent set for an empty query, substring `q` match otherwise. */
function serverLike(_vault: string, query?: { q?: string }): ListResult {
  const q = query?.q?.toLowerCase();
  const data = q
    ? CORPUS.filter(
        (i) =>
          i.id.toLowerCase().includes(q) || i.title.toLowerCase().includes(q),
      )
    : CORPUS;
  return { data, isLoading: false, isError: false };
}

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <IntlTestProvider>{children}</IntlTestProvider>
    </QueryClientProvider>
  );
  return render(<GlobalSearchDialog />, { wrapper });
}

describe("GlobalSearchDialog", () => {
  beforeEach(() => {
    pushMock.mockReset();
    useGlobalSearchStore.setState({ isOpen: false });
    useIssueListMock.mockReset();
    useIssueListMock.mockImplementation(serverLike);
    useExactIssueMock.mockReset();
    // No exact-id lookup resolved by default; the truncation test drives it.
    useExactIssueMock.mockReturnValue({ data: undefined, isFetching: false });
  });

  it("does not render content when closed", () => {
    renderDialog();
    expect(screen.queryByTestId("global-search-input")).toBeNull();
  });

  it("previews recent issues from the server when open with no query", () => {
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const items = screen.getAllByTestId("global-search-item");
    expect(items.map((el) => el.getAttribute("data-issue-id"))).toEqual([
      "REEF-001",
      "REEF-002",
    ]);
    // Recent preview goes through the server with a small limit, not the `q`
    // facet — no client-side full-list filter.
    expect(useIssueListMock).toHaveBeenCalledWith(
      "reef-acme",
      expect.objectContaining({ limit: expect.any(String) }),
    );
    expect(useIssueListMock).not.toHaveBeenCalledWith(
      "reef-acme",
      expect.objectContaining({ q: expect.anything() }),
    );
  });

  it("caps the recent preview even when placeholder data floods it", () => {
    // `useIssueList` can hand back a prior same-vault query's rows (the whole
    // board) as placeholder while the small recent request is in flight. The
    // empty-query view still caps what it renders.
    useIssueListMock.mockReturnValue({
      data: Array.from({ length: 30 }, (_, i) =>
        makeIssue(`REEF-${String(i + 1).padStart(3, "0")}`, `Issue ${i + 1}`),
      ),
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    expect(screen.getAllByTestId("global-search-item")).toHaveLength(8);
  });

  it("sends the typed query to the server as `q` and highlights the match", async () => {
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("global-search-input"), "login");

    await waitFor(() =>
      expect(useIssueListMock).toHaveBeenCalledWith(
        "reef-acme",
        // Free text is bounded with a `limit` so a broad term does not scan the vault.
        expect.objectContaining({ q: "login", limit: "20" }),
      ),
    );
    const items = await screen.findAllByTestId("global-search-item");
    expect(items).toHaveLength(1);
    expect(items[0]?.getAttribute("data-issue-id")).toBe("REEF-001");
    expect(items[0]?.querySelector("mark")?.textContent).toBe("login");
  });

  it("navigates and closes when an item is clicked", async () => {
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    const [firstItem] = screen.getAllByTestId("global-search-item");
    expect(firstItem).toBeDefined();
    await user.click(firstItem as HTMLElement);
    expect(pushMock).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues/REEF-001",
    );
    expect(useGlobalSearchStore.getState().isOpen).toBe(false);
  });

  it("shows the empty state when the query has no matches", async () => {
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("global-search-input"), "xyz");
    await waitFor(() =>
      expect(screen.getByText("No matching issues.")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("global-search-item")).toBeNull();
  });

  it("keeps a typed id-search bounded with a `limit` (no unbounded scan)", async () => {
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("global-search-input"), "REEF-001");
    // Even an id-shaped query is capped — a short id prefix can substring-match
    // many ids, so the hot path stays bounded.
    await waitFor(() =>
      expect(useIssueListMock).toHaveBeenCalledWith(
        "reef-acme",
        expect.objectContaining({ q: "REEF-001", limit: "20" }),
      ),
    );
  });

  it("fetches a complete id directly when the bounded page omits it", async () => {
    // The bounded `q` page (created_at desc) can truncate the exact id behind 20
    // newer mentions. The page settles WITHOUT REEF-001, so a by-id lookup fires
    // and its result is merged to the top — the jump-to-id stays reliable.
    const mentions = Array.from({ length: 20 }, (_, i) =>
      makeIssue(`REEF-${String(i + 100).padStart(3, "0")}`, "Refs REEF-001"),
    );
    useIssueListMock.mockReturnValue({
      data: mentions, // page is full of mentions; the real REEF-001 didn't fit
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
    });
    useExactIssueMock.mockReturnValue({
      data: makeIssue("REEF-001", "The original"),
      isFetching: false,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("global-search-input"), "REEF-001");

    // The by-id lookup is invoked for the exact (uppercased) id + active vault...
    await waitFor(() =>
      expect(useExactIssueMock).toHaveBeenCalledWith("REEF-001", "reef-acme"),
    );
    // ...and the directly-fetched issue leads the list.
    const items = screen.getAllByTestId("global-search-item");
    expect(items[0]?.getAttribute("data-issue-id")).toBe("REEF-001");
    expect(items).toHaveLength(20); // DOM still capped
  });

  it("does not fire a by-id lookup when the page already has the exact id", async () => {
    // Common case: the exact id is on the bounded page, so no extra request.
    useIssueListMock.mockReturnValue({
      data: [makeIssue("REEF-001", "Right here")],
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("global-search-input"), "REEF-001");
    await waitFor(() =>
      expect(useIssueListMock).toHaveBeenCalledWith(
        "reef-acme",
        expect.objectContaining({ q: "REEF-001" }),
      ),
    );
    // The probe hook is called because hooks are unconditional, but with an
    // empty id here, so it does not resolve a real lookup.
    expect(useExactIssueMock).not.toHaveBeenCalledWith(
      "REEF-001",
      expect.anything(),
    );
  });

  it("floats an exact id hit above a newer issue that only mentions it", async () => {
    // Server `q` orders by created_at, so a newer issue whose title mentions the
    // id can come back first. The palette should still surface the real id at the
    // top so pressing Enter jumps to it rather than the mention.
    useIssueListMock.mockReturnValue({
      data: [
        makeIssue("REEF-200", "Follow-up to REEF-001"),
        makeIssue("REEF-001", "Original issue"),
      ],
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("global-search-input"), "REEF-001");
    await waitFor(() => {
      const items = screen.getAllByTestId("global-search-item");
      expect(items[0]?.getAttribute("data-issue-id")).toBe("REEF-001");
    });
    const items = screen.getAllByTestId("global-search-item");
    expect(items.map((el) => el.getAttribute("data-issue-id"))).toEqual([
      "REEF-001",
      "REEF-200",
    ]);
  });

  it("blocks selecting a mention while a complete-id page is still revalidating", async () => {
    // Stale-while-revalidate on the same `q` key: cached data is shown with
    // isFetching=true and isPlaceholderData=false. The cached page omits the exact
    // id and leads with a mention; the by-id probe is held off until the page
    // settles, so selection of the mention stays blocked meanwhile.
    useIssueListMock.mockReturnValue({
      data: [makeIssue("REEF-200", "Follow-up to REEF-001")],
      isLoading: false,
      isFetching: true,
      isPlaceholderData: false,
      isError: false,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("global-search-input"), "REEF-001");

    const [mention] = await screen.findAllByTestId("global-search-item");
    expect(mention?.getAttribute("data-issue-id")).toBe("REEF-200");
    await user.click(mention as HTMLElement);
    expect(pushMock).not.toHaveBeenCalled();
    expect(useGlobalSearchStore.getState().isOpen).toBe(true);
  });

  it("blocks selecting a stale row until the current query's results settle", async () => {
    // Placeholder rows (a mention of the id, not the id itself) are shown while
    // the exact-id query is still in flight. They render for feedback, but a
    // click/Enter should not navigate until the real result settles; otherwise a
    // fast pick lands on the wrong issue.
    useIssueListMock.mockReturnValue({
      data: [makeIssue("REEF-200", "Follow-up to REEF-001")],
      isLoading: false,
      isFetching: true,
      isPlaceholderData: true,
      isError: false,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("global-search-input"), "REEF-001");

    const [stale] = await screen.findAllByTestId("global-search-item");
    expect(stale?.getAttribute("data-issue-id")).toBe("REEF-200");
    await user.click(stale as HTMLElement);
    expect(pushMock).not.toHaveBeenCalled();
    expect(useGlobalSearchStore.getState().isOpen).toBe(true);
  });

  it("ranks an exact id above a longer id that merely contains it", async () => {
    // Ids are min-3-digit zero-padded, so "REEF-100" substring-matches
    // "REEF-1000". The newer (longer) id comes back first from the server, but
    // typing the exact id should still select REEF-100 on Enter.
    useIssueListMock.mockReturnValue({
      data: [
        makeIssue("REEF-1000", "Much later issue"),
        makeIssue("REEF-100", "The exact one"),
      ],
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("global-search-input"), "REEF-100");
    await waitFor(() => {
      const items = screen.getAllByTestId("global-search-item");
      expect(items[0]?.getAttribute("data-issue-id")).toBe("REEF-100");
    });
  });

  it("never shows archived rows even when placeholder data includes them", async () => {
    // `useIssueList` can hand back placeholder rows from another same-vault query
    // (e.g. the board with "Show archived" on) before the active response
    // settles; the palette should still hide archived issues.
    useIssueListMock.mockReturnValue({
      data: [
        makeIssue("REEF-001", "Active login fix"),
        makeIssue("REEF-002", "Archived login relic", {
          archived_at: "2026-05-01T00:00:00.000Z",
        }),
      ],
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("global-search-input"), "login");
    await waitFor(() => {
      const items = screen.getAllByTestId("global-search-item");
      expect(items.map((el) => el.getAttribute("data-issue-id"))).toEqual([
        "REEF-001",
      ]);
    });
  });

  it("drops stale placeholder rows that don't match the typed query", async () => {
    // `useIssueList` keeps the previous same-vault rows as placeholder data while
    // a new query key fetches. Simulate that by returning a row that does NOT
    // match the typed query regardless of args; the client safety net should hide
    // it so the palette does not offer a non-matching issue to navigate to.
    useIssueListMock.mockReturnValue({
      data: [
        makeIssue("REEF-001", "Fix login bug"),
        makeIssue("REEF-900", "Totally unrelated"),
      ],
      isLoading: false,
      isFetching: true,
      isError: false,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("global-search-input"), "login");

    await waitFor(() => {
      const items = screen.getAllByTestId("global-search-item");
      expect(items.map((el) => el.getAttribute("data-issue-id"))).toEqual([
        "REEF-001",
      ]);
    });
  });

  it("shows a loading state while the first results resolve", () => {
    useIssueListMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    expect(screen.queryByTestId("global-search-item")).toBeNull();
  });

  it("shows an error state when the server query fails", () => {
    useIssueListMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    expect(
      screen.getByText(
        "Search is unavailable right now. Try again in a moment.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("global-search-item")).toBeNull();
  });

  it("renders each result row as a real anchor to the issue", () => {
    // A real <a href> is what makes Cmd/Ctrl/middle/right-click "open in new
    // tab" work; cmdk's keyboard selection still routes through onSelect.
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const [firstItem] = screen.getAllByTestId("global-search-item");
    const anchor = firstItem?.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe(
      "/workspace/reef-acme/issues/REEF-001",
    );
    // It is not a tab stop — cmdk drives selection from the input.
    expect(anchor?.getAttribute("tabindex")).toBe("-1");
  });

  it("gives the search input an accessible name", () => {
    // cmdk shadows a caller `aria-label` with its own (empty) `aria-labelledby`,
    // so the name flows through the Command `label`; assert the combobox ends up
    // named regardless of the mechanism.
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    expect(
      screen.getByRole("combobox", { name: "Search issues" }),
    ).toBeInTheDocument();
  });

  it("disables autocomplete and spellcheck on the search input", () => {
    // cmdk's CommandInput hardcodes these; lock the behavior so a future swap
    // that drops them is caught here.
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const input = screen.getByTestId("global-search-input");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  it("groups the search icon and input under wrapper-owned focus chrome", () => {
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const input = screen.getByTestId("global-search-input");
    const wrapper = input.closest("[cmdk-input-wrapper]");
    expect(wrapper).toBeInstanceOf(HTMLElement);
    const wrapperClass = (wrapper as HTMLElement).className;

    expect(wrapperClass.split(/\s+/)).toContain("border");
    expect(wrapperClass).toContain("focus-within:border-brand");
    expect(wrapperClass).toContain("focus-within:ring-2");
    expect(wrapperClass).toContain("focus-within:ring-inset");
    expect(wrapperClass).toContain("focus-within:ring-brand/30");
    expect(wrapper?.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(input.className).toContain("focus-visible:outline-none");
    expect(input.className).toContain("focus-visible:ring-0");
  });

  it("exposes status changes through a polite live region", () => {
    useIssueListMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Searching…");
  });

  it("suppresses the dialog's inherited close button", () => {
    // The palette's input row owns the top-right space, so the inherited X is
    // suppressed (it would overlap). Esc still closes via Radix Dialog.
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("contains scroll chaining on the results list", () => {
    useGlobalSearchStore.setState({ isOpen: true });
    renderDialog();
    expect(screen.getByRole("listbox").className).toContain(
      "overscroll-contain",
    );
  });
});
