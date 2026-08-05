const {
  behaviorReason,
  clearPersistedQueryCacheOnLoad,
  runClause,
} = require("./runtime.cjs");

const ISSUE_LIST_CLAUSE = "B2:issue-list-virtualization";
const LARGE_ISSUE_LIST_CLAUSES = [
  "B2:issue-list-virtualization.B1",
  "B2:issue-list-virtualization.B2",
  "B2:issue-list-virtualization.B3",
  "B2:issue-list-virtualization.B4",
  "B2:issue-list-virtualization.B5",
];
const TAIL_ISSUE_ID = "REEF-1124";

function issueListRequests(page) {
  const urls = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/issues") {
      urls.push(url.toString());
    }
  });
  return urls;
}

function issueListResponses(page) {
  const responses = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (
      response.request().method() !== "GET" ||
      url.pathname !== "/api/issues" ||
      !response.ok()
    ) {
      return;
    }
    try {
      const body = await response.json();
      responses.push({
        url: response.url(),
        ids: (body.issues ?? [])
          .map((issue) => issue.id)
          .filter((id) => typeof id === "string"),
      });
    } catch {
      // Other API responses are not part of this evidence lane.
    }
  });
  return responses;
}

async function openLargeList(page, expect, workspace, query = "") {
  await page.evaluate(() => {
    window.localStorage.removeItem("REACT_QUERY_OFFLINE_CACHE");
  });
  await clearPersistedQueryCacheOnLoad(page);
  await page.goto(
    `/workspace/${encodeURIComponent(workspace)}/issues?view=list${
      query ? `&${query}` : ""
    }`,
  );
  await expect(
    page.locator('[data-testid="issue-list-row"]').first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-interaction-ready="true"]')).toHaveCount(1);
}

async function scrollToListEnd(page, expect) {
  const scroll = page.getByTestId("issue-list-scroll-container");
  await expect(scroll).toBeVisible();
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
}

async function visibleIssueIds(page) {
  return page
    .locator('[data-testid="issue-list-row"]')
    .evaluateAll((rows) =>
      rows
        .map((row) => row.getAttribute("data-issue-id"))
        .filter((id) => typeof id === "string"),
    );
}

async function runLargeIssueListBehavior({
  page,
  context,
  expect,
  fixture,
  relogin,
  workspace = "reef-e2e",
}) {
  const clauses = [];
  const run = async (clauseId, callback) => {
    try {
      const result = await runClause(clauseId, callback);
      clauses.push({
        id: clauseId,
        status: "pass",
        ...result,
      });
      return result;
    } catch (error) {
      const reason = behaviorReason(error);
      clauses.push({
        id: clauseId,
        status: reason ? "blocked" : "fail",
        ...(reason ? { reason } : {}),
        observable: error instanceof Error ? error.message : String(error),
        details: null,
      });
      if (error && typeof error === "object") {
        error.behavior_clauses = clauses;
      }
      throw error;
    }
  };

  await run(LARGE_ISSUE_LIST_CLAUSES[0], async () => {
    await fixture.reset("large_vault");
    await relogin(page);
    const requests = issueListRequests(page);
    const responses = issueListResponses(page);
    await openLargeList(page, expect, workspace);

    const scroll = page.getByTestId("issue-list-scroll-container");
    const initialRequest = requests.find((raw) => {
      const url = new URL(raw);
      return (
        !url.searchParams.has("cursor") &&
        url.searchParams.get("limit") === "100"
      );
    });
    expect(initialRequest).toBeTruthy();
    expect(new URL(initialRequest ?? "").searchParams.get("limit")).toBe("100");

    await expect
      .poll(() => page.locator('[data-testid="issue-list-row"]').count())
      .toBeLessThanOrEqual(50);
    const range = await scroll.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(range.scrollHeight).toBeGreaterThan(range.clientHeight);

    const cursorRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        request.method() === "GET" &&
        url.pathname === "/api/issues" &&
        url.searchParams.has("cursor")
      );
    });
    await scrollToListEnd(page, expect);
    await cursorRequest;
    await page.waitForTimeout(300);

    const cursorRequests = requests.filter((raw) =>
      new URL(raw).searchParams.has("cursor"),
    );
    expect(cursorRequests).toHaveLength(1);
    const initialPage = responses.find(
      ({ url }) => !new URL(url).searchParams.has("cursor"),
    );
    const cursorPage = responses.find(({ url }) =>
      new URL(url).searchParams.has("cursor"),
    );
    expect(initialPage).toBeDefined();
    expect(cursorPage).toBeDefined();
    expect(cursorPage?.ids.every((id) => !initialPage?.ids.includes(id))).toBe(
      true,
    );
    const mountedIds = await visibleIssueIds(page);
    expect(new Set(mountedIds).size).toBe(mountedIds.length);
    expect(mountedIds.length).toBeLessThanOrEqual(50);

    return {
      observable:
        "The list loaded an initial limit of 100, kept mounted rows bounded, and followed one duplicate-free cursor page.",
      details: {
        initial_request_limit: new URL(initialRequest ?? "").searchParams.get(
          "limit",
        ),
        mounted_row_count: mountedIds.length,
        scroll_height: range.scrollHeight,
        cursor_page_count: cursorPage?.ids.length ?? 0,
      },
    };
  });

  await run(LARGE_ISSUE_LIST_CLAUSES[1], async () => {
    await fixture.reset("large_vault");
    await relogin(page);
    await fixture.setIssueListFailure(false, 1);
    const requests = issueListRequests(page);
    const responses = issueListResponses(page);
    await openLargeList(page, expect, workspace);
    const firstPage = await expect
      .poll(() =>
        responses.find(({ url }) => {
          const parsed = new URL(url);
          return (
            !parsed.searchParams.has("cursor") &&
            parsed.searchParams.get("limit") === "100"
          );
        }),
      )
      .toBeDefined()
      .then(() =>
        responses.find(({ url }) => {
          const parsed = new URL(url);
          return (
            !parsed.searchParams.has("cursor") &&
            parsed.searchParams.get("limit") === "100"
          );
        }),
      );
    const beforeFailureIds = await visibleIssueIds(page);
    const failedResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        !response.ok() &&
        response.request().method() === "GET" &&
        url.pathname === "/api/issues" &&
        url.searchParams.has("cursor")
      );
    });
    await scrollToListEnd(page, expect);
    await failedResponsePromise;
    await expect(
      page.getByText("More issues could not be loaded.", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    const afterFailureIds = await visibleIssueIds(page);
    expect(afterFailureIds.length).toBeGreaterThan(0);
    expect(afterFailureIds.every((id) => firstPage.ids.includes(id))).toBe(
      true,
    );

    await fixture.setIssueListFailure(false);
    const retryResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        response.request().method() === "GET" &&
        url.pathname === "/api/issues" &&
        url.searchParams.has("cursor")
      );
    });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    const retryResponse = await retryResponsePromise;
    const retryBody = await retryResponse.json();
    const cursorRequests = requests.filter((raw) =>
      new URL(raw).searchParams.has("cursor"),
    );
    expect(cursorRequests).toHaveLength(2);
    expect(
      responses.filter(({ url }) => new URL(url).searchParams.has("cursor")),
    ).toHaveLength(1);
    const retryIds = (retryBody.issues ?? [])
      .map((issue) => issue.id)
      .filter((id) => typeof id === "string");
    expect(retryIds.every((id) => !firstPage.ids.includes(id))).toBe(true);

    await fixture.reset("large_vault");
    await page.close();
    page = await context.newPage();
    const sparsePage = await context.newPage();
    try {
      await clearPersistedQueryCacheOnLoad(sparsePage);
      const sparseResponses = issueListResponses(sparsePage);
      const initialSparseResponse = sparsePage.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === "/api/issues" &&
          !url.searchParams.has("cursor")
        );
      });
      await relogin(sparsePage);
      await openLargeList(sparsePage, expect, workspace);
      const initialSparseBody = await (await initialSparseResponse).json();
      const initialSparseIds = (initialSparseBody.issues ?? [])
        .map((issue) => issue.id)
        .filter((id) => typeof id === "string");
      expect(initialSparseIds).not.toContain(TAIL_ISSUE_ID);
      const filter = sparsePage.getByTestId("labels-input");
      await filter.fill("tail-marker");
      await filter.press("Enter");
      await expect(
        sparsePage.getByText("Sparse residual match", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      const matchingCursor = await expect
        .poll(() =>
          sparseResponses.find(
            (entry) =>
              new URL(entry.url).searchParams.has("cursor") &&
              entry.ids.includes(TAIL_ISSUE_ID),
          ),
        )
        .toBeDefined()
        .then(() =>
          sparseResponses.find(
            (entry) =>
              new URL(entry.url).searchParams.has("cursor") &&
              entry.ids.includes(TAIL_ISSUE_ID),
          ),
        );
      expect(matchingCursor).toBeDefined();

      return {
        observable:
          "A failed cursor page preserved loaded rows, retry succeeded, and a sparse residual label match arrived on a later page.",
        details: {
          before_failure_count: beforeFailureIds.length,
          after_failure_count: afterFailureIds.length,
          retry_count: retryIds.length,
          sparse_match_id: TAIL_ISSUE_ID,
        },
      };
    } finally {
      await sparsePage.close().catch(() => undefined);
    }
  });

  await run(LARGE_ISSUE_LIST_CLAUSES[2], async () => {
    await fixture.reset("large_vault");
    await relogin(page);
    await openLargeList(page, expect, workspace);
    const target = page.locator('[data-issue-id="REEF-0101"]');
    await page.locator('[data-testid="issue-list-row"]').first().focus();
    for (let index = 0; index < 99; index += 1) {
      await page.keyboard.press("j");
    }
    await expect(target).toBeVisible({ timeout: 15_000 });
    await expect(target).toHaveAttribute("data-keyboard-focused", "true");
    await expect(target).toHaveAttribute("tabindex", "0");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/issues\/REEF-0101\?view=list/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    return {
      observable:
        "Keyboard navigation brought the unmounted logical row into view and opened its detail route.",
      details: { focused_issue_id: "REEF-0101", keyboard_steps: 99 },
    };
  });

  await run(LARGE_ISSUE_LIST_CLAUSES[3], async () => {
    await fixture.reset("large_vault");
    await relogin(page);
    await openLargeList(page, expect, workspace, "labels=large-fixture");
    const first = page.locator('[data-issue-id="REEF-0101"]');
    const second = page.locator('[data-issue-id="REEF-0102"]');
    await page.locator('[data-testid="issue-list-row"]').first().focus();
    for (let index = 0; index < 99; index += 1) {
      await page.keyboard.press("j");
    }
    await expect(first).toBeVisible({ timeout: 15_000 });
    await expect(second).toBeVisible({ timeout: 15_000 });

    const scroll = page.getByTestId("issue-list-scroll-container");
    await first.getByTestId("issue-row-checkbox").click();
    await second
      .getByTestId("issue-row-checkbox")
      .click({ modifiers: ["Shift"] });
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(second).toHaveAttribute("aria-selected", "true");
    await page
      .getByTestId("issue-bulk-action-bar")
      .getByRole("button", { name: "Clear", exact: true })
      .click();

    await first.focus();
    const before = await scroll.evaluate((element) => element.scrollTop);
    await page.keyboard.press("l");
    await page
      .getByTestId("issue-quick-edit-anchor")
      .getByRole("button", { name: "Remove label large-fixture", exact: true })
      .click();
    await expect
      .poll(async () => {
        const state = await fixture.readState();
        return state.vaults
          .find((vault) => vault.name === workspace)
          ?.issues.find((issue) => issue.id === "REEF-0101")?.labels;
      })
      .toEqual([]);
    await expect(first).toHaveCount(0);
    const after = await scroll.evaluate((element) => element.scrollTop);
    expect(Math.abs(after - before)).toBeLessThan(240);
    return {
      observable:
        "Range selection and quick edit stayed anchored to loaded logical rows while removing the filtered label.",
      details: {
        selected_issue_ids: ["REEF-0101", "REEF-0102"],
        quick_edit_issue_id: "REEF-0101",
        anchor_delta: Math.abs(after - before),
      },
    };
  });

  await run(LARGE_ISSUE_LIST_CLAUSES[4], async () => {
    await fixture.reset("large_vault");
    await relogin(page);
    await openLargeList(page, expect, workspace);
    const cls = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let value = 0;
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry;
              if (!shift.hadRecentInput) value += shift.value;
            }
          });
          observer.observe({ type: "layout-shift", buffered: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(value);
          }, 300);
        }),
    );
    expect(cls).toBeLessThan(0.1);

    await fixture.reset("configured");
    await relogin(page);
    await page.goto(
      `/workspace/${encodeURIComponent(workspace)}/issues?view=board`,
    );
    await expect(page.getByTestId("kanban-board")).toBeVisible({
      timeout: 20_000,
    });
    return {
      observable:
        "The hard-load layout shift stayed below the canonical budget and the finite sibling board rendered after the reset.",
      details: { cls, sibling_view: "board" },
    };
  });

  return {
    clause_id: ISSUE_LIST_CLAUSE,
    observable:
      "The canonical large-list behavior completed virtualization, retry, keyboard, selection/edit, and layout checks.",
    details: { clauses },
    page,
  };
}

module.exports = {
  ISSUE_LIST_CLAUSE,
  LARGE_ISSUE_LIST_CLAUSES,
  runLargeIssueListBehavior,
};
