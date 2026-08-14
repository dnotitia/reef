import {
  type APIRequestContext,
  type Locator,
  type Page,
  expect,
  test,
} from "@playwright/test";
import {
  E2E_MOCK_URL,
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  writeIndexedDbConfig,
} from "../harness/fixture";

type ThemePreference = "light" | "dark" | "system";

interface MarkdownFixtureTask {
  scenario?: string;
  workspace?: string;
  start_path?: string;
  interaction?: {
    type?: string;
    operation?: string;
  };
}

interface RuntimeDiscovery {
  tasks?: Record<string, MarkdownFixtureTask>;
}

async function readMarkdownFixtureTask(
  request: APIRequestContext,
): Promise<MarkdownFixtureTask> {
  const response = await request.get(`${E2E_MOCK_URL}/__e2e/runtime`);
  expect(response.ok()).toBeTruthy();
  const contract = (await response.json()) as RuntimeDiscovery;
  const task = contract.tasks?.markdown_fixture;
  if (!task?.start_path) {
    throw new Error("Runtime discovery did not publish the Markdown fixture");
  }
  return task;
}

async function setTheme(
  page: Page,
  preference: ThemePreference,
  colorScheme: "light" | "dark",
): Promise<void> {
  await writeIndexedDbConfig(page, "theme", preference);
  await page.emulateMedia({ colorScheme });
  await page.evaluate((nextPreference) => {
    window.localStorage.setItem("reef.theme", nextPreference);
  }, preference);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((element) => element.classList.contains("dark")),
    )
    .toBe(colorScheme === "dark");
}

async function readMarkdownSurface(editor: Locator) {
  return editor.evaluate((root: HTMLElement) => {
    const resolveColor = (property: string) => {
      const probe = document.createElement("span");
      probe.style.setProperty("color", `var(${property})`);
      root.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const resolveBackground = (property: string) => {
      const probe = document.createElement("span");
      probe.style.setProperty("background-color", `var(${property})`);
      root.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    };
    const checkboxes = Array.from(
      root.querySelectorAll<HTMLInputElement>(
        'ul[data-type="taskList"] input[type="checkbox"]',
      ),
    );
    const paragraph = root.querySelector<HTMLElement>("p");
    const heading = root.querySelector<HTMLElement>("h1");
    const link = root.querySelector<HTMLElement>("a");
    const akbLink = root.querySelector<HTMLElement>(
      'a[data-akb-uri], a[href^="akb://"], a[href*="spec-overview"]',
    );
    const mention = root.querySelector<HTMLElement>("[data-reef-mention]");
    const inlineCode = root.querySelector<HTMLElement>("p code");
    const strong = root.querySelector<HTMLElement>("strong");
    const emphasis = root.querySelector<HTMLElement>("em");
    const strike = root.querySelector<HTMLElement>("s");
    const nestedStrike = root.querySelector<HTMLElement>("strong em s");
    const quote = root.querySelector<HTMLElement>("blockquote");
    const pre = root.querySelector<HTMLElement>("pre");
    const preCode = root.querySelector<HTMLElement>("pre code");
    const rule = root.querySelector<HTMLElement>("hr");
    const rootStyles = getComputedStyle(root);
    const directChildren = Array.from(root.children) as HTMLElement[];
    const findDirectChild = (selector: string) =>
      directChildren.find((element) => element.matches(selector));
    const directParagraphs = directChildren.filter((element) =>
      element.matches("p"),
    );
    const consecutiveParagraphPair = directParagraphs
      .map(
        (paragraph, index) => [paragraph, directParagraphs[index + 1]] as const,
      )
      .find(([, next]) => next);
    const actualGap = (first: HTMLElement, second: HTMLElement) => {
      const firstRect = first.getBoundingClientRect();
      const secondRect = second.getBoundingClientRect();
      return Math.round((secondRect.top - firstRect.bottom) * 100) / 100;
    };
    const headingMetrics = Object.fromEntries(
      (["h1", "h2", "h3"] as const).map((level) => {
        const heading = findDirectChild(level);
        if (!heading) return [level, null];
        const styles = getComputedStyle(heading);
        const previous = heading.previousElementSibling as HTMLElement | null;
        return [
          level,
          {
            fontSize: styles.fontSize,
            lineHeight: styles.lineHeight,
            fontWeight: styles.fontWeight,
            marginTop: styles.marginTop,
            marginBottom: styles.marginBottom,
            sectionGap: previous ? actualGap(previous, heading) : null,
          },
        ];
      }),
    );
    const resolveProseColor = (variable: string) => {
      const probe = document.createElement("span");
      probe.style.setProperty("color", rootStyles.getPropertyValue(variable));
      root.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const resolveProseBackground = (variable: string) => {
      const probe = document.createElement("span");
      probe.style.setProperty(
        "background-color",
        rootStyles.getPropertyValue(variable),
      );
      root.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    };

    return {
      counts: {
        headings: root.querySelectorAll("h1, h2, h3").length,
        paragraphs: root.querySelectorAll("p").length,
        strong: root.querySelectorAll("strong").length,
        emphasis: root.querySelectorAll("em").length,
        links: root.querySelectorAll('a[href="https://example.com/reef"]')
          .length,
        akbLinks: root.querySelectorAll(
          'a[data-akb-uri], a[href^="akb://"], a[href*="spec-overview"]',
        ).length,
        inlineCode: root.querySelectorAll("p code").length,
        strikethrough: root.querySelectorAll("s").length,
        nestedStrikethrough: root.querySelectorAll("strong em s").length,
        orderedLists: root.querySelectorAll("ol").length,
        unorderedLists: root.querySelectorAll('ul:not([data-type="taskList"])')
          .length,
        taskLists: root.querySelectorAll('ul[data-type="taskList"]').length,
        checkboxes: checkboxes.length,
        checkedCheckboxes: checkboxes.filter((input) => input.checked).length,
        quotes: root.querySelectorAll("blockquote").length,
        codeBlocks: root.querySelectorAll("pre code").length,
        rules: root.querySelectorAll("hr").length,
        images: root.querySelectorAll("img").length,
        mentions: root.querySelectorAll('[data-reef-mention="true"]').length,
        tables: root.querySelectorAll("table").length,
      },
      colors: {
        body: paragraph ? getComputedStyle(paragraph).color : "",
        heading: heading ? getComputedStyle(heading).color : "",
        link: link ? getComputedStyle(link).color : "",
        linkDecoration: link ? getComputedStyle(link).textDecorationColor : "",
        linkDecorationLine: link
          ? getComputedStyle(link).textDecorationLine
          : "",
        linkDecorationThickness: link
          ? getComputedStyle(link).textDecorationThickness
          : "",
        akbLinkHref:
          akbLink?.getAttribute("data-akb-uri") ??
          akbLink?.getAttribute("href") ??
          "",
        mention: mention ? getComputedStyle(mention).color : "",
        mentionDecorationLine: mention
          ? getComputedStyle(mention).textDecorationLine
          : "",
        inlineCode: inlineCode ? getComputedStyle(inlineCode).color : "",
        inlineCodeFontFamily: inlineCode
          ? getComputedStyle(inlineCode).fontFamily
          : "",
        inlineCodeLineHeight: inlineCode
          ? getComputedStyle(inlineCode).lineHeight
          : "",
        inlineCodeVerticalAlign: inlineCode
          ? getComputedStyle(inlineCode).verticalAlign
          : "",
        inlineCodeBackground: inlineCode
          ? getComputedStyle(inlineCode).backgroundColor
          : "",
        inlineCodeBorder: inlineCode
          ? getComputedStyle(inlineCode).borderTopColor
          : "",
        inlineCodeRadius: inlineCode
          ? getComputedStyle(inlineCode).borderTopLeftRadius
          : "",
        inlineCodePaddingInline: inlineCode
          ? getComputedStyle(inlineCode).paddingInlineStart
          : "",
        inlineCodePaddingBlock: inlineCode
          ? getComputedStyle(inlineCode).paddingBlockStart
          : "",
        inlineCodeBefore: inlineCode
          ? getComputedStyle(inlineCode, "::before").content
          : "",
        inlineCodeAfter: inlineCode
          ? getComputedStyle(inlineCode, "::after").content
          : "",
        strong: strong
          ? {
              color: getComputedStyle(strong).color,
              fontWeight: getComputedStyle(strong).fontWeight,
            }
          : null,
        emphasis: emphasis
          ? {
              color: getComputedStyle(emphasis).color,
              fontStyle: getComputedStyle(emphasis).fontStyle,
            }
          : null,
        strikethrough: strike
          ? {
              color: getComputedStyle(strike).color,
              decoration: getComputedStyle(strike).textDecorationLine,
            }
          : null,
        nestedStrikethrough: nestedStrike
          ? getComputedStyle(nestedStrike).textDecorationLine
          : "",
        quoteBorder: quote
          ? getComputedStyle(quote).borderInlineStartColor
          : "",
        preCode: preCode ? getComputedStyle(preCode).color : "",
        preBackground: pre ? getComputedStyle(pre).backgroundColor : "",
        ruleBorder: rule ? getComputedStyle(rule).borderTopColor : "",
        foreground: resolveColor("--foreground"),
        brand: resolveColor("--brand"),
        borderSubtle: resolveColor("--border-subtle"),
        surfaceSubtle: resolveBackground("--surface-subtle"),
      },
      proseVariables: {
        body: resolveProseColor("--tw-prose-body"),
        links: resolveProseColor("--tw-prose-links"),
        preBackground: resolveProseBackground("--tw-prose-pre-bg"),
      },
      blockOrder: directChildren.map((element) =>
        element.tagName.toLowerCase(),
      ),
      rhythm: {
        firstBlockMarginTop: directChildren[0]
          ? getComputedStyle(directChildren[0]).marginTop
          : "",
        lastBlockMarginBottom: directChildren.at(-1)
          ? getComputedStyle(directChildren.at(-1) as HTMLElement).marginBottom
          : "",
        directParagraphGap: consecutiveParagraphPair
          ? actualGap(consecutiveParagraphPair[0], consecutiveParagraphPair[1])
          : null,
        headings: headingMetrics,
      },
      text: root.textContent ?? "",
      overflow: {
        editor: root.scrollWidth <= root.clientWidth,
        document:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      },
    };
  });
}

function imageSourcesFromCsp(csp: string): string[] {
  return csp.match(/img-src\s+([^;]+)/u)?.[1]?.split(/\s+/u) ?? [];
}

const MARKDOWN_FIXTURE_IMAGE_PATH =
  "/api/e2e/assets/reef-markdown-editor-image.png";

test.describe("Hermetic Markdown editor fixture", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "markdown_fixture");
  });

  test("renders the discovered fixture through theme and Source round trips", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const task = await readMarkdownFixtureTask(request);
    expect(task).toMatchObject({
      scenario: "markdown_fixture",
      workspace: REEF_E2E_VAULT,
      interaction: {
        type: "markdown_editor",
      },
    });

    const fixtureState = await readFixtureState(request);
    const fixtureVault = fixtureState.vaults.find(
      (vault) => vault.name === REEF_E2E_VAULT,
    );
    const fixtureDocument = fixtureVault?.documents.find((document) =>
      document.path.startsWith("issues/"),
    );
    expect(fixtureDocument?.content).toContain("| Pattern | Meaning |");
    expect(fixtureDocument?.content).toContain("@alice");
    expect(fixtureDocument?.content).toContain("```ts");

    await openExistingWorkspace(page);
    const issueResponse = await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await expect(editor).toBeVisible();
    const fixtureImage = editor.getByRole("img", { name: "Fixture image" });
    await expect(fixtureImage).toHaveCount(1);
    const imageSource = await fixtureImage.getAttribute("src");
    if (!imageSource) throw new Error("Markdown fixture image has no source");
    const webOrigin = new URL(page.url()).origin;
    const imageUrl = new URL(imageSource, page.url());
    expect(imageSource).toBe(MARKDOWN_FIXTURE_IMAGE_PATH);
    expect(imageUrl.origin).toBe(webOrigin);
    expect(imageUrl.origin).not.toBe(new URL(E2E_MOCK_URL).origin);
    const imageResponse = await request.get(imageUrl.toString());
    expect(imageResponse.ok()).toBeTruthy();
    expect(imageResponse.headers()["content-type"]).toBe("image/png");
    const imageCspSources = imageSourcesFromCsp(
      issueResponse?.headers()["content-security-policy"] ?? "",
    );
    expect(imageCspSources).toContain("'self'");
    expect(imageCspSources).not.toContain(new URL(E2E_MOCK_URL).origin);
    await expect
      .poll(() =>
        fixtureImage.evaluate(
          (image: HTMLImageElement) =>
            image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
        ),
      )
      .toBe(true);
    const imageDimensions = await fixtureImage.evaluate(
      (image: HTMLImageElement) => ({
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      }),
    );
    expect(imageDimensions.naturalWidth).toBe(96);
    expect(imageDimensions.naturalHeight).toBe(48);

    const themeCases: Array<{
      preference: ThemePreference;
      colorScheme: "light" | "dark";
    }> = [
      { preference: "light", colorScheme: "light" },
      { preference: "dark", colorScheme: "dark" },
      { preference: "system", colorScheme: "light" },
      { preference: "system", colorScheme: "dark" },
    ];

    for (const { preference, colorScheme } of themeCases) {
      await setTheme(page, preference, colorScheme);
      await expect(editor).toBeVisible();

      const surface = await readMarkdownSurface(editor);
      expect(surface.counts).toMatchObject({
        headings: 3,
        paragraphs: expect.any(Number),
        strong: 2,
        emphasis: 2,
        links: 1,
        akbLinks: 1,
        inlineCode: 1,
        strikethrough: 2,
        nestedStrikethrough: 1,
        orderedLists: 1,
        unorderedLists: 1,
        taskLists: 1,
        checkboxes: 2,
        checkedCheckboxes: 1,
        quotes: 1,
        codeBlocks: 1,
        rules: 1,
        images: 1,
        mentions: 1,
        tables: 0,
      });
      expect(surface.colors.body).toBe(surface.colors.foreground);
      expect(surface.colors.heading).toBe(surface.colors.foreground);
      expect(surface.colors.link).toBe(surface.colors.brand);
      expect(surface.colors.mention).toBe(surface.colors.brand);
      expect(surface.colors.akbLinkHref).toBe(
        "akb://reef-e2e/coll/docs/doc/spec-overview.md",
      );
      expect(surface.colors.linkDecoration).toBe(surface.colors.brand);
      expect(surface.colors.linkDecorationLine).toContain("underline");
      expect(surface.colors.linkDecorationThickness).toBe("1px");
      expect(surface.colors.mentionDecorationLine).toBe("none");
      expect(surface.colors.inlineCode).toBe(surface.colors.foreground);
      expect(surface.colors.inlineCodeFontFamily).toContain("Geist Mono");
      expect(surface.colors.inlineCodeLineHeight).toBe("22px");
      expect(surface.colors.inlineCodeVerticalAlign).toBe("baseline");
      expect(surface.colors.inlineCodeBackground).toBe(
        surface.colors.surfaceSubtle,
      );
      expect(surface.colors.inlineCodeBorder).toBe(surface.colors.borderSubtle);
      expect(surface.colors.inlineCodeRadius).toBe("4px");
      expect(surface.colors.inlineCodePaddingInline).toBe("4px");
      expect(surface.colors.inlineCodePaddingBlock).toBe("2px");
      expect(surface.colors.inlineCodeBefore).toBe("none");
      expect(surface.colors.inlineCodeAfter).toBe("none");
      expect(surface.colors.strong).toMatchObject({
        color: surface.colors.foreground,
        fontWeight: "600",
      });
      expect(surface.colors.emphasis).toMatchObject({
        color: surface.colors.foreground,
        fontStyle: "italic",
      });
      expect(surface.colors.strikethrough).toMatchObject({
        color: surface.colors.foreground,
        decoration: "line-through",
      });
      expect(surface.colors.nestedStrikethrough).toBe("line-through");
      expect(surface.colors.quoteBorder).toBe(surface.colors.brand);
      expect(surface.colors.preCode).toBe(surface.colors.foreground);
      expect(surface.colors.preBackground).toBe(surface.colors.surfaceSubtle);
      expect(surface.colors.ruleBorder).toBe(surface.colors.borderSubtle);
      expect(surface.proseVariables).toEqual({
        body: surface.colors.foreground,
        links: surface.colors.foreground,
        preBackground: surface.colors.surfaceSubtle,
      });
      expect(surface.rhythm).toMatchObject({
        firstBlockMarginTop: "0px",
        lastBlockMarginBottom: "0px",
        directParagraphGap: 8,
        headings: {
          h1: {
            fontSize: "24px",
            lineHeight: "30px",
            fontWeight: "600",
            marginTop: "24px",
            marginBottom: "10px",
            sectionGap: 24,
          },
          h2: {
            fontSize: "20px",
            lineHeight: "28px",
            fontWeight: "600",
            marginTop: "22px",
            marginBottom: "8px",
            sectionGap: 22,
          },
          h3: {
            fontSize: "16px",
            lineHeight: "24px",
            fontWeight: "600",
            marginTop: "20px",
            marginBottom: "6px",
            sectionGap: 20,
          },
        },
      });
      expect(surface.overflow).toEqual({ editor: true, document: true });

      const fixtureLink = editor.getByRole("link", { name: "reef link" });
      await fixtureLink.hover();
      await expect
        .poll(() =>
          fixtureLink.evaluate(
            (element) => getComputedStyle(element).textDecorationColor,
          ),
        )
        .toBe(surface.colors.brand);
      await fixtureLink.focus();
      await expect
        .poll(() =>
          fixtureLink.evaluate(
            (element) => getComputedStyle(element).textDecorationColor,
          ),
        )
        .toBe(surface.colors.brand);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });

      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`${preference}-${colorScheme}-wysiwyg.png`),
      });

      await page
        .getByTestId("markdown-source-toggle")
        .getByRole("button")
        .click();
      const source = page.getByTestId("markdown-source-textarea");
      await expect(source).toBeVisible();
      const sourceMarkdown = await source.inputValue();
      expect(sourceMarkdown).toContain("# Markdown reference");
      expect(sourceMarkdown).toContain("한국어 문서와 English notes");
      expect(sourceMarkdown).toContain("## Structure");
      expect(sourceMarkdown).toContain("### Details");
      expect(sourceMarkdown).toContain("@alice");
      expect(sourceMarkdown).toContain("~~strikethrough~~");
      expect(sourceMarkdown).toContain("nested emphasis");
      expect(sourceMarkdown).toContain(
        "akb://reef-e2e/coll/docs/doc/spec-overview.md",
      );
      expect(sourceMarkdown).toContain("```ts");
      expect(sourceMarkdown).toContain("| Pattern | Meaning |");
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`${preference}-${colorScheme}-source.png`),
      });

      await page
        .getByTestId("markdown-source-toggle")
        .getByRole("button")
        .click();
      await expect(editor).toBeVisible();
      const roundTrip = await readMarkdownSurface(editor);
      expect(roundTrip.counts).toMatchObject({
        headings: 3,
        strong: 2,
        emphasis: 2,
        links: 1,
        akbLinks: 1,
        inlineCode: 1,
        strikethrough: 2,
        nestedStrikethrough: 1,
        orderedLists: 1,
        unorderedLists: 1,
        taskLists: 1,
        checkboxes: 2,
        checkedCheckboxes: 1,
        quotes: 1,
        codeBlocks: 1,
        rules: 1,
        images: 1,
        mentions: 1,
      });
      expect(roundTrip.text).toContain("@alice");
      expect(roundTrip.text).toContain("nested emphasis");
      expect(roundTrip.blockOrder).toEqual(surface.blockOrder);
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("tabs through Markdown links while skipping the mention", async ({
    page,
    request,
  }) => {
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await expect(editor).toBeVisible();
    const normalLink = editor.getByRole("link", { name: "reef link" });
    const akbLink = editor.getByRole("link", { name: "AKB report" });
    const mention = editor.locator('[data-reef-mention="true"]');
    const firstTaskCheckbox = editor
      .locator('ul[data-type="taskList"] input[type="checkbox"]')
      .first();

    await expect(normalLink).toHaveAttribute("tabindex", "0");
    await expect(akbLink).toHaveAttribute("tabindex", "0");
    await expect(mention).not.toHaveAttribute("tabindex");
    await expect(mention).not.toHaveRole("link");

    await editor.focus();
    await page.keyboard.press("Tab");
    await expect(normalLink).toBeFocused();
    await expect(normalLink).toHaveCSS("text-decoration-thickness", "2px");

    await page.keyboard.press("Tab");
    await expect(akbLink).toBeFocused();
    await expect(akbLink).toHaveCSS("text-decoration-thickness", "2px");

    await page.keyboard.press("Tab");
    await expect(firstTaskCheckbox).toBeFocused();
    await expect(mention).not.toBeFocused();
  });
});
