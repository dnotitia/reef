import { type Locator, type Page, expect } from "@playwright/test";

/** Wait for a rendered frame and the following layout/observer delivery. */
export async function waitForPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Measure Chromium's real CLS after fonts and rendered layout have settled. */
export async function cumulativeLayoutShift(page: Page): Promise<number> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    let value = 0;
    const collect = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput: boolean;
          value: number;
        };
        if (!shift.hadRecentInput) value += shift.value;
      }
    };
    const observer = new PerformanceObserver((list) =>
      collect(list.getEntries()),
    );
    observer.observe({ type: "layout-shift", buffered: true });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    collect(observer.takeRecords());
    observer.disconnect();
    return value;
  });
}

/** Advance real query retry callbacks while awaiting the observable error UI.
 * Install page.clock before the request so backoff timers are virtualized.
 */
export async function advanceQueryRetries(
  page: Page,
  error: Locator,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.clock.fastForward(1_000);
        return error.isVisible();
      },
      { message: "query retries reach the error surface", intervals: [0] },
    )
    .toBe(true);
}

/** Include the frame immediately preceding the first contentful paint and all later frames. */
export function framesAtFirstContentfulPaint<T extends { time: number }>(
  frames: T[],
  paintTime: number | undefined,
): T[] {
  if (
    typeof paintTime !== "number" ||
    !Number.isFinite(paintTime) ||
    paintTime <= 0
  ) {
    throw new Error("First contentful paintTime is unavailable or invalid");
  }
  const firstAtOrAfter = frames.findIndex((frame) => frame.time >= paintTime);
  if (firstAtOrAfter < 0) {
    throw new Error(
      "No animation frame was observed at or after first contentful paint",
    );
  }
  return frames.slice(Math.max(0, firstAtOrAfter - 1));
}
