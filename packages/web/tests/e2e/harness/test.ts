import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from "@playwright/test";

/**
 * Identifies the Playwright worker at every hermetic boundary. The fixture
 * server uses this value to select an isolated state store; the web runtime
 * forwards it to its local AKB/GitHub/LLM doubles.
 */
export const E2E_WORKER_HEADER = "x-reef-e2e-worker";

type TestFixtures = {
  context: BrowserContext;
  page: Page;
  request: APIRequestContext;
};

type WorkerFixtures = {
  e2eWorkerId: string;
};

/**
 * Playwright fixtures with worker-scoped hermetic identity.
 *
 * The built-in browser context is replaced so every browser request carries a
 * worker identity. The request fixture mirrors that identity for direct
 * fixture-control calls such as `/__e2e/reset` and `/__e2e/state`.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  e2eWorkerId: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API requires an object pattern.
    async ({}, use, workerInfo) => {
      await use(`worker-${workerInfo.workerIndex}`);
    },
    { scope: "worker" },
  ],

  context: async ({ browser, e2eWorkerId }, use, testInfo) => {
    const baseURL =
      typeof testInfo.project.use.baseURL === "string"
        ? testInfo.project.use.baseURL
        : undefined;
    const context = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      extraHTTPHeaders: { [E2E_WORKER_HEADER]: e2eWorkerId },
    });
    await use(context);
    await context.close();
  },

  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },

  request: async ({ playwright, e2eWorkerId }, use, testInfo) => {
    const baseURL =
      typeof testInfo.project.use.baseURL === "string"
        ? testInfo.project.use.baseURL
        : undefined;
    const request = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      extraHTTPHeaders: { [E2E_WORKER_HEADER]: e2eWorkerId },
    });
    await use(request);
    await request.dispose();
  },
});

export { expect };
export type {
  APIRequestContext,
  BrowserContext,
  Locator,
  Page,
  Request,
  Response,
  TestInfo,
};
