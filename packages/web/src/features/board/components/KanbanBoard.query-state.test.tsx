import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { IssueScope } from "@/features/issues/lib/viewMode";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ISSUES,
  KanbanBoard,
  mockApiFetch,
  resetKanbanBoardMocks,
} from "./KanbanBoard.testSupport";

function setupBoard(scope: IssueScope = "active", locale: "en" | "ko" = "en") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <IntlTestProvider locale={locale}>
        <KanbanBoard vault="reef-acme" scope={scope} />
      </IntlTestProvider>
    </QueryClientProvider>,
  );
  return client;
}

function respondWithIssues(issues = ISSUES) {
  return new Response(JSON.stringify({ issues }), { status: 200 });
}

describe("KanbanBoard query feedback", () => {
  beforeEach(() => resetKanbanBoardMocks());

  it("announces data loading without showing empty results or known counts", async () => {
    let finish: (response: Response) => void = () => {};
    mockApiFetch.mockImplementation((url) =>
      String(url).startsWith("/api/issues?")
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(new Response("{}")),
    );
    setupBoard();
    expect(screen.getByRole("status")).toHaveTextContent("Loading board");
    expect(screen.queryByTestId("kanban-empty-active")).toBeNull();
    expect(screen.queryAllByText("0", { exact: true })).toHaveLength(0);
    await act(async () => finish(respondWithIssues()));
    expect(await screen.findByText("Open A")).toBeVisible();
  });

  it("distinguishes an initial failure from a confirmed empty board and retries", async () => {
    mockApiFetch.mockImplementation(async (url) =>
      String(url).startsWith("/api/issues?")
        ? new Response(JSON.stringify({ error: "unavailable" }), {
            status: 503,
          })
        : new Response("{}"),
    );
    setupBoard();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the board. Issue counts are unavailable.",
    );
    expect(screen.queryAllByText("0", { exact: true })).toHaveLength(0);
    expect(screen.queryByTestId("kanban-empty-active")).toBeNull();
    expect(screen.queryByTestId("kanban-no-matches")).toBeNull();
    let finishRetry: (response: Response) => void = () => {};
    mockApiFetch.mockImplementation((url) =>
      String(url).startsWith("/api/issues?")
        ? new Promise<Response>((resolve) => {
            finishRetry = resolve;
          })
        : Promise.resolve(new Response("{}")),
    );
    const retry = screen.getByRole("button", { name: "Retry" });
    await userEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(retry).toHaveFocus();
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(screen.queryAllByText("0", { exact: true })).toHaveLength(0);
    await act(async () => finishRetry(respondWithIssues([])));
    expect(
      await screen.findByTestId("kanban-empty-active"),
    ).toHaveAccessibleName("No active issues");
    expect(screen.getAllByText("0", { exact: true })).toHaveLength(5);
  });

  it("keeps cards during refresh and failure and explains the manual ordering restriction", async () => {
    useIssueStore.setState({ filter: { orderingMode: "manual" } });
    mockApiFetch.mockImplementation(async () => respondWithIssues());
    const client = setupBoard();
    const card = await screen.findByText("Open A");
    let finish: (response: Response) => void = () => {};
    mockApiFetch.mockImplementation((url) =>
      String(url).startsWith("/api/issues?")
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(new Response("{}")),
    );
    let refresh: Promise<void>;
    act(() => {
      refresh = client.invalidateQueries({
        queryKey: ["issues", "list", "reef-acme"],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("kanban-query-feedback")).toHaveTextContent(
        "Updating board",
      ),
    );
    expect(screen.getByText("Open A")).toBe(card);
    expect(screen.getByTestId("kanban-query-feedback")).toHaveTextContent(
      "Manual ordering is paused until the board finishes updating.",
    );
    await act(async () => {
      finish(
        new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
      );
      await refresh;
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not update the board. Previously loaded issues are still shown.",
    );
    expect(screen.getByText("Open A")).toBe(card);
    expect(screen.queryByTestId("kanban-no-matches")).toBeNull();
    const retry = screen.getByRole("button", { name: "Retry" });
    await userEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(retry).toHaveFocus();
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(screen.getByTestId("kanban-query-feedback")).toHaveTextContent(
      "Manual ordering is paused until the board finishes updating.",
    );
    await act(async () => finish(respondWithIssues([ISSUES[0]])));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("In progress B")).toBeNull();
  });
  it("keeps the empty backlog frame mounted during a same-key refetch", async () => {
    mockApiFetch.mockImplementation(async () => respondWithIssues([]));
    const client = setupBoard("backlog");
    const empty = await screen.findByText("Your backlog board is empty");
    let finish: (response: Response) => void = () => {};
    mockApiFetch.mockImplementation((url) =>
      String(url).startsWith("/api/issues?")
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(new Response("{}")),
    );
    let refresh: Promise<void>;
    act(() => {
      refresh = client.invalidateQueries({
        queryKey: ["issues", "list", "reef-acme"],
      });
    });
    await waitFor(() =>
      expect(
        client.isFetching({ queryKey: ["issues", "list", "reef-acme"] }),
      ).toBe(1),
    );
    expect(screen.getByText("Your backlog board is empty")).toBe(empty);
    await act(async () => {
      finish(respondWithIssues([]));
      await refresh;
    });
    expect(screen.getByText("Your backlog board is empty")).toBe(empty);
  });

  it("localizes initial failure and empty recovery in Korean", async () => {
    mockApiFetch.mockImplementation(async (url) =>
      String(url).startsWith("/api/issues?")
        ? new Response(JSON.stringify({ error: "unavailable" }), {
            status: 503,
          })
        : new Response("{}"),
    );
    setupBoard("active", "ko");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "보드를 불러오지 못했습니다. 이슈 개수를 확인할 수 없습니다.",
    );
    mockApiFetch.mockImplementation(async () => respondWithIssues([]));
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(
      await screen.findByTestId("kanban-empty-active"),
    ).toHaveAccessibleName("활성 이슈가 없습니다");
    expect(screen.getByRole("link", { name: "백로그 보기" })).toHaveAttribute(
      "href",
      "/workspace/reef-acme/issues?scope=backlog&view=board",
    );
  });
});
