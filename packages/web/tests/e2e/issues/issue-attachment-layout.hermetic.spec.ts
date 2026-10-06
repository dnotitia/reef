import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  clearPersistedQueryCacheOnLoad,
  readFixtureState,
  resetFixture,
  setAttachmentReadControl,
  signInAsAlice,
  waitForAttachmentReadPending,
} from "../harness/fixture";

type LayoutFrame = {
  timeMs: number;
  activityY: number | null;
  attachmentHeading: boolean;
  loadingStatus: boolean;
  deliveryLinksY: number | null;
};

async function readLayoutFrames(page: Page) {
  return page.evaluate(() => {
    const windowWithFrames = window as typeof window & {
      __issueAttachmentLayoutFrames?: LayoutFrame[];
    };
    return windowWithFrames.__issueAttachmentLayoutFrames ?? [];
  });
}

async function waitForIssueDetail(page: Page) {
  await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
  await expect(page.getByTestId("issue-title-input")).toBeVisible();
  await expect(
    page.locator('[data-testid="issue-detail-description-label"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="markdown-editor-body-frame"]').first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Delivery links" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Activity", exact: true }),
  ).toBeVisible();
}

function installLayoutSampler(page: Page) {
  return page.addInitScript(() => {
    const windowWithFrames = window as typeof window & {
      __issueAttachmentLayoutFrames?: LayoutFrame[];
    };
    const frames: LayoutFrame[] = [];
    windowWithFrames.__issueAttachmentLayoutFrames = frames;

    const headingSectionTop = (label: string) => {
      const heading = [...document.querySelectorAll("h3")].find(
        (element) => element.textContent?.trim() === label,
      );
      const section = heading?.closest("section");
      return section ? section.getBoundingClientRect().top : null;
    };

    const sample = () => {
      const headings = [...document.querySelectorAll("h3")];
      const loadingStatus = [
        ...document.querySelectorAll('[role="status"]'),
      ].some((element) =>
        /loading attachments/i.test(element.textContent ?? ""),
      );
      frames.push({
        timeMs: performance.now(),
        activityY: headingSectionTop("Activity"),
        attachmentHeading: headings.some(
          (element) => element.textContent?.trim() === "Attachments",
        ),
        loadingStatus,
        deliveryLinksY: headingSectionTop("Delivery links"),
      });
      requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });
}

function assertStableGeometry(
  frames: LayoutFrame[],
  { requirePendingFrame = false }: { requirePendingFrame?: boolean } = {},
) {
  const measured = frames.filter(
    (frame) => frame.deliveryLinksY !== null && frame.activityY !== null,
  );
  expect(measured.length).toBeGreaterThan(1);
  expect(measured.some((frame) => frame.attachmentHeading)).toBe(false);

  const pending = measured.filter((frame) => frame.loadingStatus);
  const settled = measured.filter((frame) => !frame.loadingStatus);
  if (requirePendingFrame) expect(pending.length).toBeGreaterThan(0);
  if (pending.length > 0 && settled.length > 0) {
    const during = pending[pending.length - 1];
    const after = settled[0];
    expect(
      Math.abs((during.deliveryLinksY ?? 0) - (after.deliveryLinksY ?? 0)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((during.activityY ?? 0) - (after.activityY ?? 0)),
    ).toBeLessThanOrEqual(1);
  }
}

test.describe("Issue attachment loading layout", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
  });

  test("keeps delivery links and activity fixed across three cold reads and a delayed empty read", async ({
    page,
    request,
  }, testInfo) => {
    await signInAsAlice(page);
    await clearPersistedQueryCacheOnLoad(page);
    await installLayoutSampler(page);

    const status = page
      .locator('[role="status"]')
      .filter({ hasText: "Loading attachments" });
    const defaultRuns: LayoutFrame[][] = [];
    const issuePath = "/workspace/reef-e2e/issues/REEF-101";

    for (let run = 0; run < 3; run += 1) {
      if (run === 0) await page.goto(issuePath);
      else await page.reload();

      await waitForIssueDetail(page);
      await expect(status).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Attachments" }),
      ).toHaveCount(0);
      const frames = await readLayoutFrames(page);
      assertStableGeometry(frames);
      defaultRuns.push(frames);
    }

    await setAttachmentReadControl(request, {
      issueId: "REEF-101",
      delayMs: 1200,
    });
    await Promise.all([
      page.reload({ waitUntil: "commit" }),
      waitForAttachmentReadPending(request, "REEF-101"),
    ]);

    await waitForIssueDetail(page);
    await expect(status).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Attachments" }),
    ).toHaveCount(0);
    const pendingScreenshot = await page.screenshot();
    const pendingScreenshotPath = testInfo.outputPath(
      "empty-attachments-pending.png",
    );
    await writeFile(pendingScreenshotPath, pendingScreenshot);
    await testInfo.attach("empty-attachments-pending.png", {
      path: pendingScreenshotPath,
      contentType: "image/png",
    });

    await expect(status).toHaveCount(0, { timeout: 5_000 });
    await expect(
      page.getByRole("heading", { name: "Attachments" }),
    ).toHaveCount(0);
    const delayedFrames = await readLayoutFrames(page);
    assertStableGeometry(delayedFrames, { requirePendingFrame: true });

    const finalState = await readFixtureState(request);
    const attachmentReadPending =
      finalState.attachment_read_pending["reef-e2e:REEF-101"] ?? 0;
    expect(attachmentReadPending).toBe(0);

    const frameEvidencePath = testInfo.outputPath(
      "attachment-layout-frames.json",
    );
    await writeFile(
      frameEvidencePath,
      JSON.stringify(
        { defaultRuns, delayedRun: delayedFrames, attachmentReadPending },
        null,
        2,
      ),
    );
    await testInfo.attach("attachment-layout-frames.json", {
      path: frameEvidencePath,
      contentType: "application/json",
    });
  });
});
