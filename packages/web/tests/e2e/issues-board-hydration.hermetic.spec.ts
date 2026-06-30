import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

// Regression guard for the warm-cache hydration mismatch on the issues board.
//
// REEF-315 promoted the workspace to `/workspace/[vault]/issues` and rewrote
// useActiveVault to read the vault from the URL synchronously. That removed the
// incidental `vault=""` hydration gate that used to keep `useIssueList`
// disabled on the first client render. On a hard reload the server SSRs the
// pending board skeleton (it has no persisted query cache), while the client's
// PersistQueryClientProvider rehydrates the warm issue-list cache from
// localStorage and renders the populated board on the very first client render —
// the exact "server rendered HTML didn't match the client" mismatch React
// reports as a recoverable hydration error.
//
// jsdom unit tests cannot catch this: a `render()` is a client-only mount where
// useHydrated() is already true, so the SSR↔hydration divergence never occurs.
// It only reproduces with real SSR + hydration + a warm persisted cache, hence
// this hermetic spec.
const board = '[data-testid="kanban-board"]';
const card = '[data-testid="kanban-card"]';

const isHydrationMessage = (text: string) =>
  /hydrat|did(?:n't| not) match|server rendered HTML/i.test(text);

test.describe("Hermetic issues board hydration (REEF-315)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
  });

  test("warm-cache hard reload of the board does not hydration-mismatch", async ({
    page,
  }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && isHydrationMessage(msg.text())) {
        hydrationErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      if (isHydrationMessage(err.message)) hydrationErrors.push(err.message);
    });

    // Land on the board; this populates the `['issues','list',vault]` query
    // cache with the demo_board issues.
    await openExistingWorkspace(page);
    await expect(page.locator(board)).toBeVisible();
    await expect(page.locator(card).first()).toBeVisible();

    // Wait for the throttled persister to flush the query cache to localStorage,
    // so the reload below rehydrates a WARM cache (the regression trigger). A
    // cold reload would render the skeleton on both sides and never diverge.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const raw =
              window.localStorage.getItem("REACT_QUERY_OFFLINE_CACHE") ?? "";
            return raw.includes('"issues"') ? "warm" : "cold";
          }),
        { timeout: 5_000 },
      )
      .toBe("warm");

    // Hard reload: SSR renders the pending board skeleton; the client rehydrates
    // the warm cache. The first client render must match the server's skeleton,
    // then reveal the cached board on the post-mount render (useIssueList
    // hydration gate). A mismatch here is logged as a recoverable React error.
    await page.reload({ waitUntil: "load" });

    // The board still renders the cached issues after hydration settles.
    await expect(page.locator(board)).toBeVisible();
    await expect(page.locator(card).first()).toBeVisible();

    expect(
      hydrationErrors,
      `Unexpected hydration mismatch(es):\n${hydrationErrors.join("\n---\n")}`,
    ).toEqual([]);
  });
});
