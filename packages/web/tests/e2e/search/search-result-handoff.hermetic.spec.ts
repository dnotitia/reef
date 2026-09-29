import { type Page, expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "../harness/fixture";

const SEARCH_RESULTS = {
  planning: [
    "Polish onboarding for existing AKB workspaces across migration, access, and workspace setup flows with inherited settings and preserved planning context",
    "Validate planning context on issue cards",
  ],
  // Substring search intentionally matches "board" inside "onboarding".
  board: [
    "Polish onboarding for existing AKB workspaces across migration, access, and workspace setup flows with inherited settings and preserved planning context",
    "Wire board filters into shareable URL state",
  ],
  Review: [
    "Review monitored-repo findings",
    "Review monitored-repo enrichment results",
  ],
  Ship: ["Ship stateless BFF route handlers"],
} as const;

type SearchQuery = keyof typeof SEARCH_RESULTS;

type ColumnCount = { label: string; count: number };

type BoardFrame = {
  at: number;
  input: string;
  urlQuery: string | null;
  cardTitles: string[];
  columnCounts: ColumnCount[];
  noMatch: boolean;
  updating: boolean;
};

type SearchRequest = { query: string; at: number };
type SearchResponse = {
  query: string;
  status: number;
  at: number;
};

type FrameCaptureWindow = Window & {
  __reefBoardFrames?: BoardFrame[];
  __reefBoardFrameId?: number;
};

type TimelineFrame = {
  at: number;
  input: string;
  urlQuery: string | null;
  scheduledTitles: string[];
  unscheduledTitles: string[];
  scheduledCount: number;
  noMatch: boolean;
  updating: boolean;
};

type TimelineCaptureWindow = Window & {
  __reefTimelineFrames?: TimelineFrame[];
  __reefTimelineFrameId?: number;
  __reefTimelineObserver?: MutationObserver;
};

function watchSearchTraffic(page: Page): {
  requests: SearchRequest[];
  responses: SearchResponse[];
} {
  const traffic = {
    requests: [] as SearchRequest[],
    responses: [] as SearchResponse[],
  };

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/issues" &&
      url.searchParams.has("q")
    ) {
      traffic.requests.push({
        query: url.searchParams.get("q") ?? "",
        at: Date.now(),
      });
    }
  });

  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      response.request().method() === "GET" &&
      url.pathname === "/api/issues" &&
      url.searchParams.has("q")
    ) {
      traffic.responses.push({
        query: url.searchParams.get("q") ?? "",
        status: response.status(),
        at: Date.now(),
      });
    }
  });

  return traffic;
}

async function readCardTitles(page: Page): Promise<string[]> {
  return (
    await page.locator('[data-testid="kanban-card"] h4').allTextContents()
  )
    .map((title) => title.trim())
    .sort();
}

async function enterSettledSearch(
  page: Page,
  query: SearchQuery,
): Promise<void> {
  await page.getByTestId("search-input").fill(query);
  await expect(page.getByTestId("search-input")).toHaveValue(query);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe(query);
  await expect(page.getByTestId("search-progress-bar")).toHaveCount(0);
}

async function openDemoBoard(page: Page): Promise<void> {
  await openExistingWorkspace(page);
  await page.goto("/workspace/reef-e2e/issues?view=board&sort=priority");
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  await expect(page.getByTestId("search-input")).toBeEditable();
}

async function openDemoTimeline(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-05-22T12:00:00.000Z"));
  await openExistingWorkspace(page);
  await page.goto("/workspace/reef-e2e/issues?view=timeline&sort=priority");
  await expect(page.getByTestId("timeline-grid")).toBeVisible();
  await expect(page.getByTestId("search-input")).toBeEditable();
}

async function readTimelineTitles(page: Page): Promise<string[]> {
  return (
    await page
      .locator('[data-typography-role="timeline-title"]')
      .allTextContents()
  )
    .map((title) => title.trim())
    .sort();
}

async function startFrameCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const captureWindow = window as FrameCaptureWindow;
    captureWindow.__reefBoardFrames = [];

    const sample = () => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="search-input"]',
      );
      const cardTitles = Array.from(
        document.querySelectorAll('[data-testid="kanban-card"] h4'),
      )
        .map((title) => title.textContent?.trim() ?? "")
        .sort();
      const columnCounts = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="kanban-group-header"]',
        ),
      ).map((header) => ({
        label: header.querySelector("h3")?.textContent?.trim() ?? "",
        count: Number.parseInt(
          header.querySelector("span")?.textContent?.trim() ?? "0",
          10,
        ),
      }));

      captureWindow.__reefBoardFrames?.push({
        at: performance.now(),
        input: input?.value ?? "",
        urlQuery: new URLSearchParams(window.location.search).get("q"),
        cardTitles,
        columnCounts,
        noMatch:
          document.querySelector('[data-testid="kanban-no-matches"]') !== null,
        updating:
          document.querySelector('[data-testid="search-progress-bar"]') !==
          null,
      });
      captureWindow.__reefBoardFrameId = requestAnimationFrame(sample);
    };

    captureWindow.__reefBoardFrameId = requestAnimationFrame(sample);
  });
}

async function stopFrameCapture(page: Page): Promise<BoardFrame[]> {
  return page.evaluate(() => {
    const captureWindow = window as FrameCaptureWindow;
    if (captureWindow.__reefBoardFrameId !== undefined) {
      cancelAnimationFrame(captureWindow.__reefBoardFrameId);
    }
    return captureWindow.__reefBoardFrames ?? [];
  });
}

async function startTimelineFrameCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const captureWindow = window as TimelineCaptureWindow;
    captureWindow.__reefTimelineFrames = [];

    const record = () => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="search-input"]',
      );
      const scheduledRows = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="timeline-row"]'),
      );
      const scheduledTitles = scheduledRows
        .map(
          (row) =>
            row
              .querySelector('[data-typography-role="timeline-title"]')
              ?.textContent?.trim() ?? "",
        )
        .sort();
      const unscheduledTitles = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="timeline-unscheduled"] [data-typography-role="timeline-title"]',
        ),
      )
        .map((title) => title.textContent?.trim() ?? "")
        .sort();
      const scheduledCount = Array.from(
        document.querySelectorAll<HTMLElement>("section[aria-label]"),
      ).reduce((total, section) => {
        if (!section.querySelector('[data-testid="timeline-row"]')) {
          return total;
        }
        const countText = section.children[0]?.children[1]?.textContent ?? "";
        return total + Number.parseInt(countText.match(/\d+/u)?.[0] ?? "0", 10);
      }, 0);

      const frame: TimelineFrame = {
        at: performance.now(),
        input: input?.value ?? "",
        urlQuery: new URLSearchParams(window.location.search).get("q"),
        scheduledTitles,
        unscheduledTitles,
        scheduledCount,
        noMatch: Array.from(document.querySelectorAll("p")).some(
          (paragraph) =>
            paragraph.textContent?.trim() === "No issues match your filters.",
        ),
        updating:
          document.querySelector('[data-testid="search-progress-bar"]') !==
          null,
      };
      const previous = captureWindow.__reefTimelineFrames?.at(-1);
      if (
        previous &&
        previous.input === frame.input &&
        previous.urlQuery === frame.urlQuery &&
        previous.scheduledTitles.join("\u0000") ===
          frame.scheduledTitles.join("\u0000") &&
        previous.unscheduledTitles.join("\u0000") ===
          frame.unscheduledTitles.join("\u0000") &&
        previous.scheduledCount === frame.scheduledCount &&
        previous.noMatch === frame.noMatch &&
        previous.updating === frame.updating
      ) {
        return;
      }
      captureWindow.__reefTimelineFrames?.push(frame);
    };

    const sample = () => {
      record();
      captureWindow.__reefTimelineFrameId = requestAnimationFrame(sample);
    };

    captureWindow.__reefTimelineObserver = new MutationObserver(record);
    captureWindow.__reefTimelineObserver.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    captureWindow.__reefTimelineFrameId = requestAnimationFrame(sample);
  });
}

async function stopTimelineFrameCapture(page: Page): Promise<TimelineFrame[]> {
  return page.evaluate(() => {
    const captureWindow = window as TimelineCaptureWindow;
    if (captureWindow.__reefTimelineFrameId !== undefined) {
      cancelAnimationFrame(captureWindow.__reefTimelineFrameId);
    }
    captureWindow.__reefTimelineObserver?.disconnect();
    return captureWindow.__reefTimelineFrames ?? [];
  });
}

async function runRapidTimelineHandoff(page: Page): Promise<TimelineFrame[]> {
  const input = page.getByTestId("search-input");
  for (const query of ["board", "Review", "Ship"] as const) {
    await input.fill(query);
    await page.waitForTimeout(230);
  }

  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("Ship");
  await expect
    .poll(() => readTimelineTitles(page))
    .toEqual([...SEARCH_RESULTS.Ship].sort());
  await expect(page.getByTestId("search-progress-bar")).toHaveCount(0);
  return stopTimelineFrameCapture(page);
}

function inspectTimelineFrames(frames: TimelineFrame[]) {
  const expectedByQuery = SEARCH_RESULTS as Record<
    SearchQuery,
    readonly string[]
  >;
  const relevant = frames.filter(
    (frame) =>
      frame.urlQuery !== null && Object.hasOwn(expectedByQuery, frame.urlQuery),
  );

  return {
    sampledFrames: frames.length,
    zeroRowFrames: relevant.filter(
      (frame) =>
        frame.scheduledTitles.length + frame.unscheduledTitles.length === 0,
    ),
    noMatchFrames: relevant.filter((frame) => frame.noMatch),
    scheduledCountMismatches: relevant.filter(
      (frame) => frame.scheduledCount !== frame.scheduledTitles.length,
    ),
    settledQueryMismatches: relevant.filter((frame) => {
      if (frame.updating) return false;
      const expected = [
        ...expectedByQuery[frame.urlQuery as SearchQuery],
      ].sort();
      const visible = [
        ...frame.scheduledTitles,
        ...frame.unscheduledTitles,
      ].sort();
      return visible.join("\u0000") !== expected.join("\u0000");
    }),
  };
}

function timelineFrameEvidence(frames: TimelineFrame[]) {
  const summary = inspectTimelineFrames(frames);
  const invalidFrames = [
    summary.zeroRowFrames[0],
    summary.noMatchFrames[0],
    summary.scheduledCountMismatches[0],
    summary.settledQueryMismatches[0],
  ].filter(Boolean);
  const queryHandoffs = frames.filter(
    (frame, index) =>
      index === 0 || frame.urlQuery !== frames[index - 1]?.urlQuery,
  );
  return {
    sampledFrames: summary.sampledFrames,
    zeroRowFrames: summary.zeroRowFrames.length,
    noMatchFrames: summary.noMatchFrames.length,
    scheduledCountMismatches: summary.scheduledCountMismatches.length,
    settledQueryMismatches: summary.settledQueryMismatches.length,
    firstInvalidFrame: invalidFrames[0] ?? null,
    queryHandoffs,
    finalFrame: frames.at(-1) ?? null,
  };
}

function assertNoInvalidTimelineFrames(frames: TimelineFrame[]): void {
  const summary = inspectTimelineFrames(frames);
  expect(summary.zeroRowFrames).toEqual([]);
  expect(summary.noMatchFrames).toEqual([]);
  expect(summary.scheduledCountMismatches).toEqual([]);
  expect(summary.settledQueryMismatches).toEqual([]);
}

async function runRapidHandoff(page: Page): Promise<BoardFrame[]> {
  const input = page.getByTestId("search-input");
  for (const query of ["board", "Review", "Ship"] as const) {
    await input.fill(query);
    await page.waitForTimeout(230);
  }

  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("Ship");
  await expect
    .poll(() => readCardTitles(page))
    .toEqual([...SEARCH_RESULTS.Ship].sort());
  await expect(page.getByTestId("search-progress-bar")).toHaveCount(0);
  return stopFrameCapture(page);
}

function inspectFrames(frames: BoardFrame[]) {
  const expectedByQuery = SEARCH_RESULTS as Record<
    SearchQuery,
    readonly string[]
  >;
  const relevant = frames.filter(
    (frame) =>
      frame.urlQuery !== null && Object.hasOwn(expectedByQuery, frame.urlQuery),
  );

  return {
    sampledFrames: frames.length,
    zeroCardFrames: relevant.filter((frame) => frame.cardTitles.length === 0),
    noMatchFrames: relevant.filter((frame) => frame.noMatch),
    columnCountMismatches: relevant.filter(
      (frame) =>
        frame.columnCounts.reduce(
          (total, column) => total + column.count,
          0,
        ) !== frame.cardTitles.length,
    ),
    settledQueryMismatches: relevant.filter((frame) => {
      if (frame.updating) return false;
      const expected = [
        ...expectedByQuery[frame.urlQuery as SearchQuery],
      ].sort();
      return frame.cardTitles.join("\u0000") !== expected.join("\u0000");
    }),
  };
}

function frameSnapshot(frame: BoardFrame | undefined) {
  if (!frame) return null;
  return {
    at: frame.at,
    input: frame.input,
    urlQuery: frame.urlQuery,
    cardTitles: frame.cardTitles,
    columnCounts: frame.columnCounts,
    noMatch: frame.noMatch,
    updating: frame.updating,
  };
}

function frameEvidence(frames: BoardFrame[]) {
  const summary = inspectFrames(frames);
  const invalidFrames = [
    summary.zeroCardFrames[0],
    summary.noMatchFrames[0],
    summary.columnCountMismatches[0],
    summary.settledQueryMismatches[0],
  ].find(Boolean);

  return {
    sampledFrames: summary.sampledFrames,
    zeroCardFrames: summary.zeroCardFrames.length,
    noMatchFrames: summary.noMatchFrames.length,
    columnCountMismatches: summary.columnCountMismatches.length,
    settledQueryMismatches: summary.settledQueryMismatches.length,
    firstInvalidFrame: frameSnapshot(invalidFrames),
    queryHandoffs: frames
      .filter(
        (frame, index) =>
          index === 0 || frame.urlQuery !== frames[index - 1]?.urlQuery,
      )
      .map(frameSnapshot),
    finalFrame: frameSnapshot(frames.at(-1)),
  };
}

function assertNoInvalidFrames(frames: BoardFrame[]): void {
  const summary = inspectFrames(frames);
  expect(summary.zeroCardFrames).toEqual([]);
  expect(summary.noMatchFrames).toEqual([]);
  expect(summary.columnCountMismatches).toEqual([]);
  expect(summary.settledQueryMismatches).toEqual([]);
}

async function delaySearchResponseDelivery(
  page: Page,
  milliseconds: number,
  delayed: Array<{ query: string; status: number; delayMs: number }>,
): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/issues" && url.searchParams.has("q"),
    async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch();
      delayed.push({
        query: url.searchParams.get("q") ?? "",
        status: response.status(),
        delayMs: milliseconds,
      });
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
      await route.fulfill({ response });
    },
  );
}

test.describe("Search result handoff", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
  });

  test("keeps cached result sets through repeated three-query handoffs", async ({
    page,
  }) => {
    await openDemoBoard(page);
    const traffic = watchSearchTraffic(page);

    for (const query of ["planning", "board", "Review", "Ship"] as const) {
      await enterSettledSearch(page, query);
    }
    const warmRequests = [...traffic.requests];
    await expect.poll(() => traffic.responses.length).toBe(warmRequests.length);
    const warmResponses = [...traffic.responses];
    expect(warmRequests.map((entry) => entry.query)).toEqual([
      "planning",
      "board",
      "Review",
      "Ship",
    ]);
    expect(warmResponses.map((entry) => entry.status)).toEqual([
      200, 200, 200, 200,
    ]);

    const delayed = [] as Array<{
      query: string;
      status: number;
      delayMs: number;
    }>;
    const runs: Array<{ repetition: number; frames: BoardFrame[] }> = [];

    await enterSettledSearch(page, "planning");
    await startFrameCapture(page);
    runs.push({ repetition: 1, frames: await runRapidHandoff(page) });

    await delaySearchResponseDelivery(page, 700, delayed);
    for (const repetition of [2, 3] as const) {
      await enterSettledSearch(page, "planning");
      await startFrameCapture(page);
      runs.push({ repetition, frames: await runRapidHandoff(page) });
    }

    const handoffRequests = traffic.requests.slice(warmRequests.length);
    const frames = runs.flatMap((run) => run.frames);
    process.stdout.write(
      `SEARCH_RESULT_FRAME_EVIDENCE ${JSON.stringify({
        condition:
          "demo_board; warm cache; three repetitions; 230ms query intervals",
        warmRequests,
        warmResponses,
        handoffRequests,
        delayedResponses: delayed,
        runs: runs.map((run) => ({
          repetition: run.repetition,
          ...frameEvidence(run.frames),
        })),
        summary: frameEvidence(frames),
      })}\n`,
    );

    expect(handoffRequests).toEqual([]);
    expect(delayed).toEqual([]);
    assertNoInvalidFrames(frames);
  });

  test("keeps cached Timeline rows through repeated three-query handoffs", async ({
    page,
  }) => {
    await openDemoTimeline(page);
    const traffic = watchSearchTraffic(page);

    for (const query of ["planning", "board", "Review", "Ship"] as const) {
      await enterSettledSearch(page, query);
    }
    const warmRequests = [...traffic.requests];
    await expect.poll(() => traffic.responses.length).toBe(warmRequests.length);
    const warmResponses = [...traffic.responses];
    expect(warmRequests.map((entry) => entry.query)).toEqual([
      "planning",
      "board",
      "Review",
      "Ship",
    ]);
    expect(warmResponses.map((entry) => entry.status)).toEqual([
      200, 200, 200, 200,
    ]);

    const runs: Array<{ repetition: number; frames: TimelineFrame[] }> = [];
    for (const repetition of [1, 2, 3] as const) {
      await enterSettledSearch(page, "planning");
      await startTimelineFrameCapture(page);
      runs.push({
        repetition,
        frames: await runRapidTimelineHandoff(page),
      });
    }

    const handoffRequests = traffic.requests.slice(warmRequests.length);
    const frames = runs.flatMap((run) => run.frames);
    process.stdout.write(
      `TIMELINE_SEARCH_RESULT_FRAME_EVIDENCE ${JSON.stringify({
        condition:
          "demo_board; timeline Q2 2026; warm cache; three repetitions; 230ms query intervals",
        warmRequests,
        warmResponses,
        handoffRequests,
        runs: runs.map((run) => ({
          repetition: run.repetition,
          ...timelineFrameEvidence(run.frames),
        })),
        summary: timelineFrameEvidence(frames),
      })}\n`,
    );

    expect(handoffRequests).toEqual([]);
    assertNoInvalidTimelineFrames(frames);
  });

  test("retains the previous result set while uncached responses are delayed", async ({
    page,
  }) => {
    await openDemoBoard(page);
    const traffic = watchSearchTraffic(page);
    await enterSettledSearch(page, "planning");

    const delayed = [] as Array<{
      query: string;
      status: number;
      delayMs: number;
    }>;
    await delaySearchResponseDelivery(page, 700, delayed);
    const requestsBeforeHandoff = traffic.requests.length;
    await startFrameCapture(page);
    const frames = await runRapidHandoff(page);
    const handoffRequests = traffic.requests.slice(requestsBeforeHandoff);
    const handoffResponses = traffic.responses.slice(1);
    process.stdout.write(
      `SEARCH_RESULT_FRAME_EVIDENCE ${JSON.stringify({
        condition:
          "demo_board; uncached queries; 700ms response delivery; 230ms query intervals",
        handoffRequests,
        handoffResponses,
        delayedResponses: delayed,
        frames: frameEvidence(frames),
      })}\n`,
    );

    expect(handoffRequests.map((entry) => entry.query)).toEqual([
      "board",
      "Review",
      "Ship",
    ]);
    expect(handoffResponses.map((entry) => entry.status)).toEqual([
      200, 200, 200,
    ]);
    const expectedDelayed = [
      { query: "board", status: 200, delayMs: 700 },
      { query: "Review", status: 200, delayMs: 700 },
      { query: "Ship", status: 200, delayMs: 700 },
    ];
    expect([...delayed].sort((a, b) => a.query.localeCompare(b.query))).toEqual(
      [...expectedDelayed].sort((a, b) => a.query.localeCompare(b.query)),
    );
    assertNoInvalidFrames(frames);
  });

  test("converges through uncached responses without added delay", async ({
    page,
  }) => {
    await openDemoBoard(page);
    const traffic = watchSearchTraffic(page);
    await enterSettledSearch(page, "planning");
    const requestsBeforeHandoff = traffic.requests.length;

    await startFrameCapture(page);
    const frames = await runRapidHandoff(page);
    const handoffRequests = traffic.requests.slice(requestsBeforeHandoff);
    const handoffResponses = traffic.responses.slice(1);
    process.stdout.write(
      `SEARCH_RESULT_FRAME_EVIDENCE ${JSON.stringify({
        condition:
          "demo_board; uncached queries; no added response delay; 230ms query intervals",
        handoffRequests,
        handoffResponses,
        frames: frameEvidence(frames),
      })}\n`,
    );

    expect(handoffRequests.map((entry) => entry.query)).toEqual([
      "board",
      "Review",
      "Ship",
    ]);
    expect(handoffResponses.map((entry) => entry.status)).toEqual([
      200, 200, 200,
    ]);
    assertNoInvalidFrames(frames);
  });

  test("keeps a settled true zero-result search empty with its no-match state", async ({
    page,
  }) => {
    await openDemoBoard(page);
    const query = "zzznomatch";
    await page.getByTestId("search-input").fill(query);
    await expect(page.getByTestId("search-input")).toHaveValue(query);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe(query);
    await expect(page.getByTestId("search-progress-bar")).toHaveCount(0);
    await expect(page.getByTestId("kanban-card")).toHaveCount(0);
    await expect(page.getByTestId("kanban-no-matches")).toBeVisible();
    await expect
      .poll(async () => {
        const counts = await page
          .locator('[data-testid="kanban-group-header"] span')
          .allTextContents();
        return counts.reduce((total, count) => total + Number(count), 0);
      })
      .toBe(0);
  });
});
