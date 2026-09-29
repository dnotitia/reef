import { expect, test, type Page } from "@playwright/test";
import {
  openExistingWorkspace,
  resetFixture,
  writeIndexedDbConfig,
} from "../harness/fixture";

interface ThemeFrame {
  at: number;
  dark: boolean;
  id: string | null;
  tag: string | null;
  backgroundColor: string | null;
  hoverColor: string;
  left: number | null;
  top: number | null;
  width: number | null;
  height: number | null;
  ariaPressed: string | null;
}

interface ThemePaintProbe {
  initial: { at: number; dark: boolean };
  paints: Array<{
    name: string;
    at: number;
    observedAt: number;
    dark: boolean;
    pageColor: string;
    switcher: ThemeFrame | null;
  }>;
  rootChanges: Array<{ at: number; dark: boolean }>;
  switchers: ThemeFrame[];
  cspViolations: string[];
}

declare global {
  interface Window {
    __themePaintProbe?: ThemePaintProbe;
  }
}

const issuesPath = "/workspace/reef-e2e/issues?view=board";
const hydrationMessage = (value: string) =>
  /hydrat|did(?:n't| not) match|server rendered HTML/i.test(value);

async function installThemePaintProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const root = () => document.documentElement;
    const probe: ThemePaintProbe = {
      initial: {
        at: performance.now(),
        dark: root()?.classList.contains("dark") ?? false,
      },
      paints: [],
      rootChanges: [],
      switchers: [],
      cspViolations: [],
    };
    window.__themePaintProbe = probe;

    const isDark = () => root()?.classList.contains("dark") ?? false;
    const hoverColors: Partial<Record<"light" | "dark", string>> = {};
    const readHoverColor = () => {
      const mode = isDark() ? "dark" : "light";
      const cached = hoverColors[mode];
      if (cached) return cached;
      const marker = document.createElement("span");
      marker.style.backgroundColor = "var(--surface-hover)";
      marker.style.position = "fixed";
      marker.style.visibility = "hidden";
      const documentRoot = root();
      if (!documentRoot) return "";
      documentRoot.append(marker);
      const color = getComputedStyle(marker).backgroundColor;
      marker.remove();
      if (color !== "rgba(0, 0, 0, 0)") hoverColors[mode] = color;
      return color;
    };
    const readSwitcher = (): ThemeFrame | null => {
      const selected =
        document.querySelector<HTMLElement>(
          '[data-testid^="view-switcher-"][aria-pressed="true"]',
        ) ??
        document.querySelector<HTMLElement>(
          '[data-testid="view-switcher-board"]',
        );
      if (!selected) return null;
      const rect = selected.getBoundingClientRect();
      return {
        at: performance.now(),
        dark: isDark(),
        id: selected.dataset.testid ?? null,
        tag: selected.tagName,
        backgroundColor: getComputedStyle(selected).backgroundColor,
        hoverColor: readHoverColor(),
        left: Number(rect.left.toFixed(2)),
        top: Number(rect.top.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
        ariaPressed: selected.getAttribute("aria-pressed"),
      };
    };
    const captureSwitcher = () => {
      const frame = readSwitcher();
      if (!frame) return;
      const previous = probe.switchers.at(-1);
      const signature = (entry: ThemeFrame) =>
        JSON.stringify([
          entry.dark,
          entry.id,
          entry.tag,
          entry.backgroundColor,
          entry.hoverColor,
          entry.left,
          entry.top,
          entry.width,
          entry.height,
          entry.ariaPressed,
        ]);
      if (!previous || signature(previous) !== signature(frame)) {
        probe.switchers.push(frame);
      }
    };

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const documentRoot = root();
          probe.paints.push({
            name: entry.name,
            at: entry.startTime,
            observedAt: performance.now(),
            dark: isDark(),
            pageColor: documentRoot
              ? getComputedStyle(documentRoot)
                  .getPropertyValue("--surface-page")
                  .trim()
              : "",
            switcher: readSwitcher(),
          });
        }
      });
      observer.observe({ type: "paint", buffered: true });
    } catch {
      // The test reports a missing paint entry if Chromium lacks this observer.
    }

    document.addEventListener("securitypolicyviolation", (event) => {
      probe.cspViolations.push(
        `${event.violatedDirective}:${event.blockedURI}:${event.sourceFile}`,
      );
    });

    const stopAt = performance.now() + 4_000;
    let previousDark = isDark();
    const sampleFrames = () => {
      const dark = isDark();
      if (dark !== previousDark) {
        probe.rootChanges.push({ at: performance.now(), dark });
        previousDark = dark;
      }
      captureSwitcher();
      if (performance.now() < stopAt) requestAnimationFrame(sampleFrames);
    };
    requestAnimationFrame(sampleFrames);
  });
}

async function waitForProbePaint(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      window.__themePaintProbe?.paints.some(
        (entry) => entry.name === "first-contentful-paint",
      ) ?? false,
    undefined,
    { timeout: 15_000 },
  );
}

async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

function firstContentfulPaint(probe: ThemePaintProbe | null) {
  return probe?.paints.find((entry) => entry.name === "first-contentful-paint");
}

test.describe("theme first paint", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
  });

  test("keeps the selected view stable before and after hydration", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await openExistingWorkspace(page);
    await writeIndexedDbConfig(page, "theme", "dark");
    await page.evaluate(() =>
      window.localStorage.setItem("reef.theme", "dark"),
    );
    await installThemePaintProbe(page);

    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && hydrationMessage(message.text())) {
        hydrationErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      if (hydrationMessage(error.message)) hydrationErrors.push(error.message);
    });

    let allowScripts = false;
    let releaseScriptGate: (() => void) | undefined;
    let blockedScriptCount = 0;
    const scriptGate = new Promise<void>((resolve) => {
      releaseScriptGate = resolve;
    });
    await page.route("**/_next/static/**/*.js", async (route) => {
      if (!allowScripts) {
        blockedScriptCount += 1;
        await scriptGate;
      }
      await route.continue();
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.clearBrowserCache");

    const problems: string[] = [];
    let before: ThemePaintProbe | null = null;
    let beforeControl: {
      tag: string | null;
      interactionReady: boolean;
      buttonCount: number;
    } | null = null;
    const response = await page.goto(issuesPath, { waitUntil: "commit" });
    try {
      await waitForProbePaint(page);
      await page.waitForFunction(() =>
        Boolean(document.querySelector('[data-testid="view-switcher-board"]')),
      );
      before = await page.evaluate(() => window.__themePaintProbe ?? null);
      beforeControl = await page.evaluate(() => ({
        tag:
          document.querySelector('[data-testid="view-switcher-board"]')
            ?.tagName ?? null,
        interactionReady: Boolean(
          document.querySelector('[data-interaction-ready="true"]'),
        ),
        buttonCount: document.querySelectorAll(
          '[data-testid^="view-switcher-"][aria-pressed]',
        ).length,
      }));
      await testInfo.attach("before-hydration-switcher.png", {
        body: await page.locator('[data-testid="view-switcher"]').screenshot(),
        contentType: "image/png",
      });
    } catch (error) {
      problems.push(
        `Could not capture the first paint: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      allowScripts = true;
      releaseScriptGate?.();
    }

    await expect(
      page.locator('[data-testid="view-switcher-board"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-interaction-ready="true"]')).toHaveCount(
      1,
    );
    await cdp.detach();
    await settleFrames(page);
    const after = await page.evaluate(() => window.__themePaintProbe ?? null);
    const nonce = response?.headers()["x-nonce"];
    const csp = response?.headers()["content-security-policy"] ?? "";
    const bootstrapNonce = await page
      .locator("script[data-theme-bootstrap]")
      .evaluate((script) => (script as HTMLScriptElement).nonce);
    const afterControl = await page
      .locator('[data-testid="view-switcher-board"]')
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const marker = document.createElement("span");
        marker.style.backgroundColor = "var(--surface-hover)";
        marker.style.position = "fixed";
        marker.style.visibility = "hidden";
        document.documentElement.append(marker);
        const hoverColor = getComputedStyle(marker).backgroundColor;
        marker.remove();
        return {
          tag: element.tagName,
          id: (element as HTMLElement).dataset.testid ?? null,
          backgroundColor: getComputedStyle(element).backgroundColor,
          hoverColor,
          left: Number(rect.left.toFixed(2)),
          top: Number(rect.top.toFixed(2)),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
        };
      });
    await testInfo.attach("after-hydration-switcher.png", {
      body: await page.locator('[data-testid="view-switcher"]').screenshot(),
      contentType: "image/png",
    });
    await testInfo.attach("hydration-observations.json", {
      body: JSON.stringify(
        {
          responseStatus: response?.status(),
          noncePresent: Boolean(nonce),
          bootstrapNonceMatches: Boolean(nonce && bootstrapNonce === nonce),
          cspHasMatchingNonce: Boolean(
            nonce && csp.includes(`'nonce-${nonce}'`),
          ),
          blockedScriptCount,
          before,
          beforeControl,
          after,
          afterControl,
          hydrationErrorCount: hydrationErrors.length,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    const beforePaint = firstContentfulPaint(before);
    if (!beforePaint?.dark)
      problems.push("The first contentful paint was not dark.");
    if (blockedScriptCount === 0)
      problems.push("No Next.js script was held before hydration.");
    if (beforeControl?.tag !== "SPAN")
      problems.push("The pre-hydration view switcher was interactive.");
    if (beforeControl?.interactionReady)
      problems.push("The shell became interactive before hydration.");
    if ((beforeControl?.buttonCount ?? 0) !== 0)
      problems.push("View buttons appeared before hydration.");
    if (beforePaint?.switcher?.id !== "view-switcher-board") {
      problems.push("The first-paint switcher did not select Board.");
    }
    if (
      beforePaint?.switcher?.backgroundColor !==
      beforePaint?.switcher?.hoverColor
    ) {
      problems.push(
        "The placeholder selected fill did not match the active theme.",
      );
    }
    if (afterControl.backgroundColor !== afterControl.hoverColor) {
      problems.push(
        "The hydrated selected fill did not match the active theme.",
      );
    }
    if (
      !nonce ||
      bootstrapNonce !== nonce ||
      !csp.includes(`'nonce-${nonce}'`)
    ) {
      problems.push(
        "The theme bootstrap script did not carry the response CSP nonce.",
      );
    }
    if (
      beforePaint?.switcher &&
      beforePaint.switcher.tag !== afterControl.tag
    ) {
      for (const key of ["left", "top", "width", "height"] as const) {
        const beforeValue = beforePaint.switcher[key];
        const afterValue = afterControl[key];
        if (beforeValue === null || Math.abs(beforeValue - afterValue) > 1) {
          problems.push(
            `The selected control changed ${key} during hydration.`,
          );
        }
      }
    }
    if (
      after?.cspViolations.some((violation) => violation.includes(":inline:"))
    ) {
      problems.push("The theme bootstrap script was blocked by CSP.");
    }
    if (hydrationErrors.length)
      problems.push("The page reported a hydration mismatch.");
    expect(problems).toEqual([]);
  });

  test("applies stored Light, Dark, and System preferences on warm and cold loads", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await openExistingWorkspace(page);
    await installThemePaintProbe(page);

    const cases = [
      { preference: "dark", os: "light", expectedDark: true },
      { preference: "light", os: "dark", expectedDark: false },
      { preference: "system", os: "light", expectedDark: false },
      { preference: "system", os: "dark", expectedDark: true },
    ] as const;
    const problems: string[] = [];
    const cdp = await page.context().newCDPSession(page);

    for (const themeCase of cases) {
      await page.emulateMedia({ colorScheme: themeCase.os });
      await writeIndexedDbConfig(page, "theme", themeCase.preference);
      await page.evaluate((preference) => {
        window.localStorage.setItem("reef.theme", preference);
      }, themeCase.preference);

      for (const cache of ["warm", "cold"] as const) {
        if (cache === "cold") await cdp.send("Network.clearBrowserCache");
        const response =
          cache === "warm"
            ? await page.goto(issuesPath, { waitUntil: "commit" })
            : await page.reload({ waitUntil: "commit" });
        await expect(page.getByTestId("kanban-board")).toBeVisible();
        await expect(
          page.locator(
            '[data-testid="view-switcher-board"][aria-pressed="true"]',
          ),
        ).toBeVisible();
        await waitForProbePaint(page);
        await settleFrames(page);

        const probe = await page.evaluate(
          () => window.__themePaintProbe ?? null,
        );
        const fcp = firstContentfulPaint(probe);
        const nonce = response?.headers()["x-nonce"];
        const csp = response?.headers()["content-security-policy"] ?? "";
        const bootstrapNonce = await page
          .locator("script[data-theme-bootstrap]")
          .evaluate((script) => (script as HTMLScriptElement).nonce);
        const frames = (probe?.switchers ?? []).filter(
          (frame) =>
            frame.at >= (fcp?.at ?? Number.POSITIVE_INFINITY) &&
            frame.id === "view-switcher-board" &&
            (frame.width ?? 0) > 0 &&
            frame.hoverColor !== "rgba(0, 0, 0, 0)",
        );
        const lateWrongColorFrames = frames.filter(
          (frame) =>
            frame.dark !== themeCase.expectedDark ||
            frame.backgroundColor !== frame.hoverColor,
        );

        await testInfo.attach(
          `${themeCase.preference}-${themeCase.os}-${cache}.json`,
          {
            body: JSON.stringify(
              {
                responseStatus: response?.status(),
                preference: themeCase.preference,
                os: themeCase.os,
                cache,
                expectedDark: themeCase.expectedDark,
                probe,
                noncePresent: Boolean(nonce),
                bootstrapNonceMatches: Boolean(
                  nonce && bootstrapNonce === nonce,
                ),
                cspHasMatchingNonce: Boolean(
                  nonce && csp.includes(`'nonce-${nonce}'`),
                ),
                lateWrongColorFrameCount: lateWrongColorFrames.length,
              },
              null,
              2,
            ),
            contentType: "application/json",
          },
        );
        await testInfo.attach(
          `${themeCase.preference}-${themeCase.os}-${cache}-switcher.png`,
          {
            body: await page
              .locator('[data-testid="view-switcher"]')
              .screenshot(),
            contentType: "image/png",
          },
        );

        if (!fcp)
          problems.push(
            `${themeCase.preference}/${themeCase.os}/${cache}: no FCP entry.`,
          );
        else if (fcp.dark !== themeCase.expectedDark) {
          problems.push(
            `${themeCase.preference}/${themeCase.os}/${cache}: first paint used the wrong theme.`,
          );
        }
        if (
          probe?.rootChanges.some(
            (change) =>
              change.at > (fcp?.at ?? 0) &&
              change.dark !== themeCase.expectedDark,
          )
        ) {
          problems.push(
            `${themeCase.preference}/${themeCase.os}/${cache}: the root changed to the opposite theme after FCP.`,
          );
        }
        if (lateWrongColorFrames.length) {
          problems.push(
            `${themeCase.preference}/${themeCase.os}/${cache}: selected background lagged the root theme.`,
          );
        }
        if (!nonce || !csp.includes(`'nonce-${nonce}'`)) {
          problems.push(
            `${themeCase.preference}/${themeCase.os}/${cache}: the root response did not carry its matching CSP nonce.`,
          );
        }
        if (!nonce || bootstrapNonce !== nonce) {
          problems.push(
            `${themeCase.preference}/${themeCase.os}/${cache}: the theme bootstrap script did not carry the response CSP nonce.`,
          );
        }
      }
    }

    await cdp.detach();
    expect(problems).toEqual([]);
  });

  test("applies the system theme to a shell-free 404 at first paint", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await installThemePaintProbe(page);
    const response = await page.goto(`/missing-theme-${Date.now()}`);
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
    await waitForProbePaint(page);

    const probe = await page.evaluate(() => window.__themePaintProbe ?? null);
    const fcp = firstContentfulPaint(probe);
    const nonce = response?.headers()["x-nonce"];
    const csp = response?.headers()["content-security-policy"] ?? "";
    const bootstrapNonce = await page
      .locator("script[data-theme-bootstrap]")
      .evaluate((script) => (script as HTMLScriptElement).nonce);
    await testInfo.attach("shell-free-404-theme.json", {
      body: JSON.stringify(
        {
          responseStatus: response?.status(),
          probe,
          noncePresent: Boolean(nonce),
          bootstrapNonceMatches: Boolean(nonce && bootstrapNonce === nonce),
          cspHasMatchingNonce: Boolean(
            nonce && csp.includes(`'nonce-${nonce}'`),
          ),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    await testInfo.attach("shell-free-404.png", {
      body: await page.getByRole("main").screenshot(),
      contentType: "image/png",
    });

    expect(response?.status()).toBe(404);
    expect(fcp?.dark).toBe(true);
    expect(nonce).toBeTruthy();
    expect(bootstrapNonce).toBe(nonce);
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(
      probe?.cspViolations.some((violation) => violation.includes(":inline:")),
    ).toBe(false);
    expect(
      probe?.rootChanges.some(
        (change) => change.at > (fcp?.at ?? 0) && !change.dark,
      ),
    ).toBe(false);
  });
});
