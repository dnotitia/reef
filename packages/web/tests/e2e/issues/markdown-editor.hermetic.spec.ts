import { waitForIssueContentSave } from "../harness/issue-content";
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
  setMarkdownLinkSearchControl,
  waitForMarkdownLinkSearchIdle,
  waitForMarkdownLinkSearchPending,
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
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

type ElementBox = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

interface ScrollOwnerState {
  testId: string | null;
  scrollTop: number;
}

async function readNearestScrollOwner(
  locator: Locator,
): Promise<ScrollOwnerState | null> {
  return locator.evaluate((element) => {
    let ancestor = element.parentElement;
    while (ancestor) {
      const styles = getComputedStyle(ancestor);
      if (
        (styles.overflowY === "auto" || styles.overflowY === "scroll") &&
        ancestor.scrollHeight > ancestor.clientHeight
      ) {
        return {
          testId: ancestor.getAttribute("data-testid"),
          scrollTop: ancestor.scrollTop,
        };
      }
      ancestor = ancestor.parentElement;
    }
    return null;
  });
}

async function waitForLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function wheelWithin(
  page: Page,
  target: Locator,
  viewport: Locator,
  deltaY: number,
): Promise<boolean> {
  const [targetBox, viewportBox] = await Promise.all([
    target.boundingBox(),
    viewport.boundingBox(),
  ]);
  if (!targetBox || !viewportBox) return false;

  const left = Math.max(targetBox.x, viewportBox.x);
  const right = Math.min(
    targetBox.x + targetBox.width,
    viewportBox.x + viewportBox.width,
  );
  const top = Math.max(targetBox.y, viewportBox.y);
  const bottom = Math.min(
    targetBox.y + targetBox.height,
    viewportBox.y + viewportBox.height,
  );
  if (right <= left || bottom <= top) return false;

  await page.mouse.move((left + right) / 2, (top + bottom) / 2);
  await page.mouse.wheel(0, deltaY);
  await waitForLayout(page);
  return true;
}

async function measureImageMenu(image: Locator, action: Locator) {
  const [imageBox, actionBox, scrollOwner] = await Promise.all([
    image.boundingBox(),
    action.boundingBox(),
    readNearestScrollOwner(image),
  ]);
  return {
    imageVisible: await image.isVisible(),
    actionVisible: await action.isVisible(),
    scrollOwnerTestId: scrollOwner?.testId ?? null,
    scrollTop: scrollOwner?.scrollTop ?? null,
    imageBox,
    actionBox,
    horizontalGap:
      imageBox && actionBox
        ? Math.max(
            imageBox.x - (actionBox.x + actionBox.width),
            actionBox.x - (imageBox.x + imageBox.width),
            0,
          )
        : null,
    verticalDistance:
      imageBox && actionBox
        ? Math.abs(actionBox.y + actionBox.height / 2 - imageBox.y)
        : null,
  };
}

async function countVisible(locator: Locator): Promise<number> {
  return locator.evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const styles = getComputedStyle(element);
        return (
          element.getClientRects().length > 0 &&
          styles.display !== "none" &&
          styles.visibility !== "hidden"
        );
      }).length,
  );
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
    const normalLists = Array.from(
      root.querySelectorAll<HTMLOListElement | HTMLUListElement>(
        'ol:not([data-type="taskList"]), ul:not([data-type="taskList"])',
      ),
    );
    const taskItems = Array.from(
      root.querySelectorAll<HTMLElement>('ul[data-type="taskList"] > li'),
    );
    const paragraph = root.querySelector<HTMLElement>("p");
    const heading = root.querySelector<HTMLElement>("h1");
    const link = root.querySelector<HTMLElement>("a");
    const akbLink = root.querySelector<HTMLElement>(
      'a[data-akb-uri], a[href^="akb://"], a[href*="spec-overview"]',
    );
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
    const normalListMetrics = normalLists.map((list) => {
      const firstItem = list.querySelector<HTMLElement>(":scope > li");
      const secondItem = list.querySelector<HTMLElement>(":scope > li + li");
      const firstParagraph =
        firstItem?.querySelector<HTMLElement>(":scope > p");
      const marker = firstItem
        ? getComputedStyle(firstItem, "::marker").color
        : "";
      return {
        tagName: list.tagName.toLowerCase(),
        paddingInlineStart: getComputedStyle(list).paddingInlineStart,
        marker,
        directParagraphMargin: firstParagraph
          ? getComputedStyle(firstParagraph).marginBlock
          : "",
        siblingGap:
          firstItem && secondItem ? actualGap(firstItem, secondItem) : null,
      };
    });
    const taskItemMetrics = taskItems.map((item) => {
      const checkbox = item.querySelector<HTMLInputElement>(
        ':scope > label > input[type="checkbox"]',
      );
      const paragraph = item.querySelector<HTMLElement>(":scope > div > p");
      const checkboxRect = checkbox?.getBoundingClientRect();
      const paragraphRect = paragraph?.getBoundingClientRect();
      return {
        checked: item.getAttribute("data-checked"),
        checkboxWidth: checkbox ? getComputedStyle(checkbox).width : "",
        checkboxHeight: checkbox ? getComputedStyle(checkbox).height : "",
        accentColor: checkbox ? getComputedStyle(checkbox).accentColor : "",
        bodyColor: paragraph ? getComputedStyle(paragraph).color : "",
        bodyDecoration: paragraph
          ? getComputedStyle(paragraph).textDecorationLine
          : "",
        firstRowCenterDelta:
          checkboxRect && paragraphRect
            ? Math.round(
                Math.abs(
                  checkboxRect.top +
                    checkboxRect.height / 2 -
                    (paragraphRect.top +
                      Math.min(paragraphRect.height, 22) / 2),
                ) * 100,
              ) / 100
            : null,
      };
    });
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
        quoteParagraphs: quote?.querySelectorAll(":scope > p").length ?? 0,
        quoteLists:
          quote?.querySelectorAll(":scope > ul, :scope > ol").length ?? 0,
        quoteNestedOrderedLists:
          quote?.querySelectorAll(":scope > ul ol").length ?? 0,
        codeBlocks: root.querySelectorAll("pre code").length,
        rules: root.querySelectorAll("hr").length,
        images: root.querySelectorAll('img[data-markdown-image="true"]').length,
        fileLinks: root.querySelectorAll('a[data-markdown-target*="/file/"]')
          .length,
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
        akbLinkTarget:
          akbLink?.getAttribute("data-markdown-target") ??
          akbLink?.getAttribute("data-akb-uri") ??
          akbLink?.getAttribute("href") ??
          "",
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
        quoteBorderWidth: quote
          ? getComputedStyle(quote).borderInlineStartWidth
          : "",
        quoteBackground: quote ? getComputedStyle(quote).backgroundColor : "",
        quoteFontStyle: quote ? getComputedStyle(quote).fontStyle : "",
        quoteFontWeight: quote ? getComputedStyle(quote).fontWeight : "",
        quotePaddingBlock: quote
          ? getComputedStyle(quote).paddingBlockStart
          : "",
        quotePaddingInline: quote
          ? getComputedStyle(quote).paddingInlineStart
          : "",
        quoteFirstChildMarginTop: quote
          ? getComputedStyle(quote.firstElementChild as HTMLElement).marginTop
          : "",
        quoteLastChildMarginBottom: quote
          ? getComputedStyle(quote.lastElementChild as HTMLElement).marginBottom
          : "",
        preCode: preCode ? getComputedStyle(preCode).color : "",
        preCodeFontFamily: preCode ? getComputedStyle(preCode).fontFamily : "",
        preCodeFontSize: preCode ? getComputedStyle(preCode).fontSize : "",
        preCodeLineHeight: preCode ? getComputedStyle(preCode).lineHeight : "",
        preCodeWhiteSpace: preCode ? getComputedStyle(preCode).whiteSpace : "",
        preCodeLanguage: preCode?.className ?? "",
        preBackground: pre ? getComputedStyle(pre).backgroundColor : "",
        preBorder: pre ? getComputedStyle(pre).borderTopColor : "",
        preRadius: pre ? getComputedStyle(pre).borderTopLeftRadius : "",
        prePaddingInline: pre ? getComputedStyle(pre).paddingInlineStart : "",
        prePaddingBlock: pre ? getComputedStyle(pre).paddingBlockStart : "",
        preOverflowX: pre ? getComputedStyle(pre).overflowX : "",
        preWhiteSpace: pre ? getComputedStyle(pre).whiteSpace : "",
        ruleBorder: rule ? getComputedStyle(rule).borderTopColor : "",
        ruleBorderWidth: rule ? getComputedStyle(rule).borderTopWidth : "",
        ruleBorderStyle: rule ? getComputedStyle(rule).borderTopStyle : "",
        ruleMarginBlock: rule
          ? {
              start: getComputedStyle(rule).marginBlockStart,
              end: getComputedStyle(rule).marginBlockEnd,
            }
          : null,
        foreground: resolveColor("--foreground"),
        brand: resolveColor("--brand-text"),
        brandGlyph: resolveColor("--brand-glyph"),
        brandFocus: resolveColor("--brand-focus"),
        mutedForeground: resolveColor("--muted-foreground"),
        borderSubtle: resolveColor("--border-subtle"),
        surfaceSubtle: resolveBackground("--surface-subtle"),
      },
      normalListMetrics,
      taskItemMetrics,
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
        codeBlock: pre ? pre.scrollWidth > pre.clientWidth : false,
        codeBlockContained: pre
          ? pre.scrollWidth > pre.clientWidth &&
            root.scrollWidth <= root.clientWidth
          : false,
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

async function readCommentMarkdownSurface(comment: Locator) {
  return comment.evaluate((root: HTMLElement) => {
    const paragraph = root.querySelector<HTMLElement>("p");
    const heading = root.querySelector<HTMLElement>(
      '[data-streamdown^="heading-"], h1, h2, h3',
    );
    const link = root.querySelector<HTMLElement>('[data-streamdown="link"], a');
    const mention = root.querySelector<HTMLElement>("[data-reef-mention]");
    const inlineCode = root.querySelector<HTMLElement>(
      '[data-streamdown="inline-code"], p code',
    );
    const codeBlock = root.querySelector<HTMLElement>(
      '[data-streamdown="code-block"]',
    );
    const codeBlockBody = root.querySelector<HTMLElement>(
      '[data-streamdown="code-block-body"], pre',
    );
    const tableWrapper = root.querySelector<HTMLElement>(
      '[data-streamdown="table-wrapper"]',
    );
    const rootStyles = getComputedStyle(root);
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
    const commentContained = root.scrollWidth <= root.clientWidth;
    const codeBlockOverflows = codeBlockBody
      ? codeBlockBody.scrollWidth > codeBlockBody.clientWidth
      : false;

    return {
      counts: {
        headings: root.querySelectorAll(
          '[data-streamdown^="heading-"], h1, h2, h3',
        ).length,
        paragraphs: root.querySelectorAll("p").length,
        strong: root.querySelectorAll('strong, [data-streamdown="strong"]')
          .length,
        emphasis: root.querySelectorAll("em").length,
        links: root.querySelectorAll('[data-streamdown="link"], a').length,
        inlineCode: root.querySelectorAll(
          '[data-streamdown="inline-code"], p code',
        ).length,
        strikethrough: root.querySelectorAll("s, del").length,
        orderedLists: root.querySelectorAll(
          '[data-streamdown="ordered-list"], ol',
        ).length,
        unorderedLists: root.querySelectorAll(
          '[data-streamdown="unordered-list"], ul',
        ).length,
        taskLists:
          root.querySelectorAll("li.task-list-item").length > 0 ? 1 : 0,
        checkboxes: root.querySelectorAll('input[type="checkbox"]').length,
        checkedCheckboxes: root.querySelectorAll(
          'input[type="checkbox"]:checked',
        ).length,
        quotes: root.querySelectorAll(
          '[data-streamdown="blockquote"], blockquote',
        ).length,
        codeBlocks: codeBlock ? 1 : codeBlockBody ? 1 : 0,
        rules: root.querySelectorAll('[data-streamdown="horizontal-rule"], hr')
          .length,
        images: root.querySelectorAll('[data-streamdown="image"], img').length,
        tables: root.querySelectorAll('[data-streamdown="table"], table')
          .length,
        mentions: root.querySelectorAll("[data-reef-mention]").length,
      },
      colors: {
        body: paragraph ? getComputedStyle(paragraph).color : "",
        heading: heading ? getComputedStyle(heading).color : "",
        link: link ? getComputedStyle(link).color : "",
        linkDecoration: link ? getComputedStyle(link).textDecorationColor : "",
        mention: mention ? getComputedStyle(mention).color : "",
        inlineCode: inlineCode ? getComputedStyle(inlineCode).color : "",
        inlineCodeBackground: inlineCode
          ? getComputedStyle(inlineCode).backgroundColor
          : "",
        inlineCodeBorder: inlineCode
          ? getComputedStyle(inlineCode).borderTopColor
          : "",
        codeBackground: codeBlockBody
          ? getComputedStyle(codeBlockBody).backgroundColor
          : "",
        codeBorder: codeBlock ? getComputedStyle(codeBlock).borderTopColor : "",
        codeOverflowX: codeBlockBody
          ? getComputedStyle(codeBlockBody).overflowX
          : "",
        codeWhiteSpace: codeBlockBody
          ? getComputedStyle(codeBlockBody).whiteSpace
          : "",
        tableBorder: tableWrapper
          ? getComputedStyle(tableWrapper).borderTopColor
          : "",
        foreground: resolveColor("--foreground"),
        brand: resolveColor("--brand-text"),
        brandGlyph: resolveColor("--brand-glyph"),
        brandFocus: resolveColor("--brand-focus"),
        borderSubtle: resolveColor("--border-subtle"),
        surfaceSubtle: resolveBackground("--surface-subtle"),
      },
      typography: {
        fontSize: rootStyles.fontSize,
        lineHeight: rootStyles.lineHeight,
      },
      overflow: {
        comment: commentContained,
        codeBlock: codeBlockOverflows,
        codeBlockContained: codeBlockOverflows && commentContained,
        table: tableWrapper
          ? tableWrapper.scrollWidth >= tableWrapper.clientWidth
          : false,
        images: Array.from(root.querySelectorAll("img")).every(
          (image) => image.getBoundingClientRect().width <= root.clientWidth,
        ),
        document:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      },
    };
  });
}

const MARKDOWN_FIXTURE_IMAGE_PATH =
  "/api/e2e/assets/reef-markdown-editor-image.png";
const MARKDOWN_FIXTURE_LARGE_IMAGE_PATH =
  "/api/e2e/assets/reef-markdown-editor-large.svg";
const MARKDOWN_FIXTURE_TRANSPARENT_IMAGE_PATH =
  "/api/e2e/assets/reef-markdown-editor-transparent.svg";
const MARKDOWN_FIXTURE_FILE_URI = "akb://reef-e2e/issues/file/incident-log";

// The editor joins consecutive image-only paragraphs when it serializes Source after reload.
function normalizeAdjacentImageOnlyBlocks(markdown: string): string {
  return markdown.replace(
    /^([ \t]*!\[[^\]\r\n]*\]\([^\r\n)]*\)[ \t]*)\r?\n[ \t]*\r?\n(?=[ \t]*!\[[^\]\r\n]*\]\([^\r\n)]*\)[ \t]*$)/gmu,
    "$1",
  );
}

function expectMarkdownFileProxyUrl(href: string, pageUrl: string): URL {
  const url = new URL(href, pageUrl);
  expect(url.pathname).toBe("/api/files");
  expect(url.searchParams.get("vault")).toBe(REEF_E2E_VAULT);
  expect(url.searchParams.get("uri")).toBe(MARKDOWN_FIXTURE_FILE_URI);
  expect(url.searchParams.get("download")).toBe("1");
  return url;
}

test.describe("Hermetic Markdown editor fixture", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "markdown_fixture");
  });

  test("matches Reef toolbar divider, alignment, and icon color", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");

    const readChrome = (toolbar: Locator) =>
      toolbar.evaluate((outer) => {
        const inner = outer.querySelector<HTMLElement>('[role="toolbar"]');
        const formattingButton = inner?.querySelector<HTMLElement>(
          "button[data-markdown-toolbar-button]",
        );
        const inactiveButton = inner?.querySelector<HTMLElement>(
          'button[data-markdown-toolbar-button][aria-pressed="false"]:not(:disabled)',
        );
        const sourceButton = outer.querySelector<HTMLElement>(
          '[data-testid="markdown-source-toggle"] button',
        );
        if (!inner || !formattingButton || !inactiveButton || !sourceButton) {
          throw new Error("Markdown toolbar chrome is incomplete");
        }
        const mutedProbe = document.createElement("span");
        mutedProbe.style.color = "var(--muted-foreground)";
        outer.append(mutedProbe);
        const reefMutedColor = getComputedStyle(mutedProbe).color;
        mutedProbe.remove();
        const formattingBox = formattingButton.getBoundingClientRect();
        const sourceBox = sourceButton.getBoundingClientRect();
        return {
          outerDivider: getComputedStyle(outer).borderBottomWidth,
          innerDivider: getComputedStyle(inner).borderBottomWidth,
          innerDividerColor: getComputedStyle(inner).borderBottomColor,
          iconColor: getComputedStyle(inactiveButton).color,
          reefMutedColor,
          centerOffset:
            sourceBox.top +
            sourceBox.height / 2 -
            (formattingBox.top + formattingBox.height / 2),
        };
      });
    const expectChrome = async (toolbar: Locator) => {
      await expect(toolbar.getByRole("toolbar")).toBeVisible();
      const chrome = await readChrome(toolbar);
      expect(chrome.outerDivider).toBe("1px");
      expect(chrome.innerDivider).toBe("1px");
      expect(chrome.innerDividerColor).toBe("rgba(0, 0, 0, 0)");
      expect(chrome.iconColor).toBe(chrome.reefMutedColor);
      expect(Math.abs(chrome.centerOffset)).toBeLessThanOrEqual(0.5);
    };
    await expectChrome(page.getByTestId("markdown-toolbar"));

    await page.getByTestId("issue-close").click();
    await page.getByTestId("new-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    const newIssueToolbar = dialog.getByTestId("markdown-toolbar");
    await expectChrome(newIssueToolbar);
    await dialog.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("new-issue-toolbar-en.png"),
    });

    await page.goto(`/workspace/${REEF_E2E_VAULT}/settings/preferences`);
    const language = page.getByRole("region", { name: /^(Language|언어)$/u });
    await language.getByTestId("locale-option-ko").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await page.goto(task.start_path ?? "");
    await page.getByTestId("issue-close").click();
    await page.getByTestId("new-issue-trigger").click();
    const koreanDialog = page.getByTestId("new-issue-dialog");
    await expect(koreanDialog).toBeVisible();
    await expectChrome(koreanDialog.getByTestId("markdown-toolbar"));
    await koreanDialog.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("new-issue-toolbar-ko.png"),
    });
  });

  test("keeps the focused editor chrome continuous across the toolbar divider", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(90_000);
    testInfo.snapshotSuffix = "";
    await page.setViewportSize({ width: 1440, height: 900 });

    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");

    const wrapper = page.getByTestId("markdown-editor");
    const toolbar = page.getByTestId("markdown-toolbar");
    const editor = wrapper.locator(".reef-markdown-editor");
    await expect(editor).toBeVisible();
    await editor.focus();
    await expect(editor).toBeFocused();

    const wrapperBox = await wrapper.boundingBox();
    const toolbarBox = await toolbar.boundingBox();
    expect(wrapperBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    if (!wrapperBox || !toolbarBox) return;

    const focusIntersection = await page.screenshot({
      animations: "disabled",
      clip: {
        x: wrapperBox.x,
        y: toolbarBox.y + toolbarBox.height - 3,
        width: 8,
        height: 7,
      },
    });
    expect(focusIntersection).toMatchSnapshot(
      "markdown-focused-toolbar-intersection.png",
    );
  });

  test("keeps link search surfaces opaque and readable in light and dark themes", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");

    const editor = page.locator(".reef-markdown-editor");
    const toolbar = page.getByTestId("markdown-toolbar");
    const openLinkPopup = () =>
      toolbar.getByRole("group", { name: "Insert" }).getByRole("button").last();
    const themes: Array<{
      preference: ThemePreference;
      colorScheme: "light" | "dark";
    }> = [
      { preference: "light", colorScheme: "light" },
      { preference: "dark", colorScheme: "dark" },
    ];

    for (const theme of themes) {
      await setTheme(page, theme.preference, theme.colorScheme);
      await editor.locator("p").first().click();
      await openLinkPopup().click();

      const popup = page.locator("[data-markdown-link-popup]");
      await expect(popup).toBeVisible();
      const search = popup.getByRole("combobox", {
        name: "Search Vault resources",
      });
      const searchResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/documents/search" &&
          url.searchParams.get("q") === "incident"
        );
      });
      await search.fill("incident");
      expect((await searchResponse).status()).toBe(200);

      const option = popup.getByRole("option", {
        name: "incident.log (File)",
      });
      await expect(option).toBeVisible();
      await search.focus();
      await search.press("ArrowDown");
      await search.press("ArrowDown");
      await expect(option).toHaveAttribute("aria-selected", "true");
      await page.mouse.move(0, 0);

      const styles = await popup.evaluate((dialog) => {
        const searchInput = dialog.querySelector<HTMLInputElement>(
          'input[role="combobox"]',
        );
        const inputs = Array.from(
          dialog.querySelectorAll<HTMLInputElement>("input"),
        );
        const results = dialog.querySelector<HTMLElement>('[role="listbox"]');
        const selected = results?.querySelector<HTMLElement>(
          '[role="option"][aria-selected="true"]',
        );
        const selectedDetail = selected?.querySelector<HTMLElement>("span");
        const title = dialog.querySelector<HTMLElement>("h2");
        if (
          !searchInput ||
          !results ||
          !selected ||
          !selectedDetail ||
          !title
        ) {
          throw new Error(
            "Markdown link search did not render its expected surfaces",
          );
        }
        return {
          dialogBackground: getComputedStyle(dialog).backgroundColor,
          dialogForeground: getComputedStyle(title).color,
          inputBackgrounds: inputs.map(
            (input) => getComputedStyle(input).backgroundColor,
          ),
          inputForeground: getComputedStyle(searchInput).color,
          inputPlaceholder: getComputedStyle(searchInput, "::placeholder")
            .color,
          resultsBackground: getComputedStyle(results).backgroundColor,
          selectedBackground: getComputedStyle(selected).backgroundColor,
          selectedForeground: getComputedStyle(selected).color,
          selectedDetailForeground: getComputedStyle(selectedDetail).color,
        };
      });
      await setMarkdownLinkSearchControl(request, {
        query: "missing resource",
        failureStatus: 503,
      });
      const errorResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/documents/search" &&
          url.searchParams.get("q") === "missing resource"
        );
      });
      await search.fill("missing resource");
      // The Reef Route Handler collapses upstream AKB 5xx responses to 502.
      expect((await errorResponse).status()).toBe(502);
      const alert = popup.getByRole("alert");
      await expect(alert).toBeVisible();
      const checks = await popup.evaluate((dialog, colors) => {
        const alertElement =
          dialog.querySelector<HTMLElement>('[role="alert"]');
        if (!alertElement) throw new Error("Markdown search error is missing");

        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context)
          throw new Error("Canvas 2D color conversion is unavailable");

        const rgba = (value: string) => {
          if (!CSS.supports("color", value)) return undefined;
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          const pixel = context.getImageData(0, 0, 1, 1).data;
          return {
            channels: [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0],
            alpha: (pixel[3] ?? 0) / 255,
          };
        };
        const isOpaque = (value: string) => rgba(value)?.alpha === 1;
        const contrastRatio = (foreground: string, background: string) => {
          const foregroundColor = rgba(foreground);
          const backgroundColor = rgba(background);
          if (
            !foregroundColor ||
            !backgroundColor ||
            backgroundColor.alpha < 1
          ) {
            return 0;
          }

          const composite = foregroundColor.channels.map(
            (channel, index) =>
              channel * foregroundColor.alpha +
              (backgroundColor.channels[index] ?? 0) *
                (1 - foregroundColor.alpha),
          );
          const luminance = (channels: number[]) =>
            channels
              .map((channel) => {
                const normalized = channel / 255;
                return normalized <= 0.04045
                  ? normalized / 12.92
                  : ((normalized + 0.055) / 1.055) ** 2.4;
              })
              .reduce(
                (sum, channel, index) =>
                  sum + channel * ([0.2126, 0.7152, 0.0722][index] ?? 0),
                0,
              );
          const lighter = Math.max(
            luminance(composite),
            luminance(backgroundColor.channels),
          );
          const darker = Math.min(
            luminance(composite),
            luminance(backgroundColor.channels),
          );
          return (lighter + 0.05) / (darker + 0.05);
        };

        return {
          dialogOpaque: isOpaque(colors.dialogBackground),
          inputsOpaque: colors.inputBackgrounds.every(isOpaque),
          resultsOpaque: isOpaque(colors.resultsBackground),
          selectedOpaque: isOpaque(colors.selectedBackground),
          dialogTextContrast: contrastRatio(
            colors.dialogForeground,
            colors.dialogBackground,
          ),
          inputTextContrast: contrastRatio(
            colors.inputForeground,
            colors.inputBackgrounds[0] ?? "",
          ),
          placeholderContrast: contrastRatio(
            colors.inputPlaceholder,
            colors.inputBackgrounds[0] ?? "",
          ),
          selectedTextContrast: contrastRatio(
            colors.selectedForeground,
            colors.selectedBackground,
          ),
          selectedDetailContrast: contrastRatio(
            colors.selectedDetailForeground,
            colors.selectedBackground,
          ),
          errorTextContrast: contrastRatio(
            getComputedStyle(alertElement).color,
            colors.dialogBackground,
          ),
        };
      }, styles);
      const failures: string[] = [];
      if (!checks.dialogOpaque)
        failures.push("dialog background is transparent");
      if (!checks.inputsOpaque)
        failures.push("an input background is transparent");
      if (!checks.resultsOpaque)
        failures.push("results background is transparent");
      if (!checks.selectedOpaque)
        failures.push("selected result background is transparent");
      if (checks.dialogTextContrast < 4.5)
        failures.push("dialog text contrast is below 4.5:1");
      if (checks.inputTextContrast < 4.5)
        failures.push("search input text contrast is below 4.5:1");
      if (checks.placeholderContrast < 4.5)
        failures.push("search placeholder contrast is below 4.5:1");
      if (checks.selectedTextContrast < 4.5)
        failures.push("selected result text contrast is below 4.5:1");
      if (checks.selectedDetailContrast < 4.5)
        failures.push("selected result detail contrast is below 4.5:1");
      if (checks.errorTextContrast < 4.5)
        failures.push("search error text contrast is below 4.5:1");
      expect(
        failures,
        `${theme.preference} link popup checks: ${JSON.stringify(checks)}`,
      ).toEqual([]);
      await popup.getByRole("button", { name: "Cancel" }).click();
    }
  });

  test("searches permitted documents and files and applies canonical Markdown links", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editorRoot = page.getByTestId("markdown-editor");
    const editor = page.locator(".reef-markdown-editor");
    const toolbar = editorRoot.getByTestId("markdown-toolbar");
    const openLinkPopup = () =>
      toolbar.getByRole("group", { name: "Insert" }).getByRole("button").last();
    const sourceToggle = page
      .getByTestId("markdown-source-toggle")
      .getByRole("button");

    const applySearchResult = async (
      paragraphIndex: number,
      query: string,
      optionName: string,
      targetUri: string,
      expectedText: string,
    ) => {
      const paragraph = editor.locator("p").nth(paragraphIndex);
      await paragraph.click();
      await openLinkPopup().click();
      const popup = page.locator("[data-markdown-link-popup]");
      await expect(popup).toBeVisible();
      const search = popup.getByRole("combobox", {
        name: "Search Vault resources",
      });
      const resultsResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/documents/search" &&
          url.searchParams.get("q") === query
        );
      });
      await search.click();
      await expect(search).toBeFocused();
      await page.keyboard.type(query);
      await expect(search).toHaveValue(query);
      const response = await resultsResponse;
      expect(response.status()).toBe(200);
      const payload = (await response.json()) as {
        results: Array<{ uri: string }>;
      };
      expect(payload.results).toEqual(
        expect.arrayContaining([expect.objectContaining({ uri: targetUri })]),
      );
      const option = popup.getByRole("option", { name: optionName });
      await expect(option).toBeVisible();
      await option.click();
      await expect(popup.getByLabel("URL")).toHaveValue(targetUri);
      await expect(popup.getByLabel("Text")).toHaveValue(expectedText);
      await popup.getByRole("button", { name: "Insert link" }).click();
      await expect(popup).not.toBeVisible();
      return expectedText;
    };

    const documentUri = "akb://reef-e2e/coll/docs/doc/alpha-reference.md";
    const previousDocumentUri = "akb://reef-e2e/coll/docs/doc/spec-overview.md";
    const fileLinkText = await applySearchResult(
      0,
      "incident",
      "incident.log (File)",
      MARKDOWN_FIXTURE_FILE_URI,
      "incident.log",
    );
    const documentLinkText = await applySearchResult(
      1,
      "Alpha reference",
      "Alpha reference (Document)",
      documentUri,
      "Alpha reference",
    );
    await expect(
      editor.locator('a[data-markdown-target*="/file/"]').first(),
    ).toHaveAttribute("href", /^\/api\/files\?/);

    const lastParagraph = editor.locator("p").last();
    await lastParagraph.click();
    await openLinkPopup().click();
    const pendingPopup = page.locator("[data-markdown-link-popup]");
    const pendingSearch = pendingPopup.getByRole("combobox", {
      name: "Search Vault resources",
    });
    await setMarkdownLinkSearchControl(request, {
      query: "incident",
      delayMs: 500,
    });
    await pendingSearch.fill("incident");
    await waitForMarkdownLinkSearchPending(request, "incident");
    await pendingPopup.getByRole("button", { name: "Cancel" }).click();
    await expect(pendingPopup).not.toBeVisible();
    await expect(editor).toBeFocused();
    await waitForMarkdownLinkSearchIdle(request, "incident");

    await setMarkdownLinkSearchControl(request, {
      query: "missing resource",
      failureStatus: 503,
    });
    await openLinkPopup().click();
    const errorPopup = page.locator("[data-markdown-link-popup]");
    await errorPopup
      .getByRole("combobox", { name: "Search Vault resources" })
      .fill("missing resource");
    await expect(errorPopup.getByRole("alert")).toHaveText(
      "Unable to search resources. Check your access and try again.",
    );
    await errorPopup.getByRole("button", { name: "Cancel" }).click();
    await setMarkdownLinkSearchControl(request, {
      query: "missing resource",
    });

    await sourceToggle.click();
    const source = page.locator('[data-markdown-mode="source"] textarea');
    await expect.poll(() => source.inputValue()).toContain(documentUri);
    const appliedMarkdown = await source.inputValue();
    expect(appliedMarkdown).toContain(
      `[${fileLinkText}](${MARKDOWN_FIXTURE_FILE_URI})`,
    );
    expect(appliedMarkdown).toContain(`[${documentLinkText}](${documentUri})`);
    expect(appliedMarkdown).not.toContain("/api/assets/");
    expect(appliedMarkdown).not.toContain("signed");
    await sourceToggle.click();

    const toolbarUndo = toolbar.getByRole("button", { name: "Undo" });
    const toolbarRedo = toolbar.getByRole("button", { name: "Redo" });
    await expect(toolbarUndo).toBeEnabled();
    await toolbarUndo.click();
    await sourceToggle.click();
    await expect.poll(() => source.inputValue()).not.toContain(documentUri);
    expect(await source.inputValue()).toContain(previousDocumentUri);
    await sourceToggle.click();
    await expect(toolbarRedo).toBeEnabled();
    await toolbarRedo.click();
    await sourceToggle.click();
    await expect.poll(() => source.inputValue()).toContain(documentUri);
    const finalMarkdown = await source.inputValue();
    expect(finalMarkdown).toContain(
      `[${fileLinkText}](${MARKDOWN_FIXTURE_FILE_URI})`,
    );
    expect(finalMarkdown).toContain(`[${documentLinkText}](${documentUri})`);

    const saveResponse = waitForIssueContentSave(
      page,
      "REEF-001",
      finalMarkdown,
    );
    await page.getByTestId("issue-title-input").click();
    const saved = await saveResponse;
    expect(saved.ok(), `save failed with ${saved.status()}`).toBeTruthy();
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === REEF_E2E_VAULT)
          ?.documents.find((document) => document.path === "issues/reef-001.md")
          ?.content;
      })
      .toBe(finalMarkdown);

    await page.reload();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await sourceToggle.click();
    const reopenedSource = page.locator(
      '[data-markdown-mode="source"] textarea',
    );
    const reopenedMarkdown = await reopenedSource.inputValue();
    expect(normalizeAdjacentImageOnlyBlocks(reopenedMarkdown)).toBe(
      normalizeAdjacentImageOnlyBlocks(finalMarkdown),
    );
    expect(reopenedMarkdown).toContain(
      `[${fileLinkText}](${MARKDOWN_FIXTURE_FILE_URI})`,
    );
    expect(reopenedMarkdown).toContain(`[${documentLinkText}](${documentUri})`);
    await setMarkdownLinkSearchControl(request, {
      query: "incident",
    });
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
    expect(fixtureDocument?.content).toContain(
      `![Large fixture image](${MARKDOWN_FIXTURE_LARGE_IMAGE_PATH})`,
    );
    expect(fixtureDocument?.content).toContain(
      `[incident.log](${MARKDOWN_FIXTURE_FILE_URI})`,
    );
    expect(fixtureDocument?.content).toContain("REEF-002");
    const fixtureComment = fixtureVault?.comments.find(
      (comment) => comment.reef_id === "REEF-001",
    );
    expect(fixtureComment).toMatchObject({
      body: fixtureDocument?.content,
      author: "bob",
      mention_recipients: ["alice"],
    });

    await openExistingWorkspace(page);
    const issueResponse = await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await expect(editor).toBeVisible();
    const commentRenderer = page.locator(".reef-markdown-comment").first();
    await expect(commentRenderer).toBeVisible();
    await expect(
      commentRenderer.locator('[data-streamdown="heading-1"], h1'),
    ).toHaveCount(1);
    await commentRenderer.scrollIntoViewIfNeeded();
    const commentLink = commentRenderer
      .locator('[data-streamdown="link"], a')
      .first();
    await expect(commentLink).toBeVisible();
    await expect(
      commentRenderer.getByRole("link", { name: "reef link" }),
    ).toHaveAttribute("href", "https://example.com/reef");
    await expect(
      commentRenderer.getByRole("link", { name: "reef link" }),
    ).toHaveAttribute("target", "_blank");
    await expect(
      commentRenderer.getByRole("link", { name: "AKB report" }),
    ).toHaveAttribute("href", "akb://reef-e2e/coll/docs/doc/spec-overview.md");
    const commentFileLink = commentRenderer.getByRole("link", {
      name: "incident.log",
    });
    await expect(commentFileLink).toHaveAttribute(
      "data-reef-file-uri",
      MARKDOWN_FIXTURE_FILE_URI,
    );
    await expect(commentFileLink).toHaveAttribute("target", "_blank");
    const commentFileHref = await commentFileLink.getAttribute("href");
    expect(commentFileHref).toContain(
      "/api/issues/REEF-001/attachments/file?vault=reef-e2e&uri=",
    );
    expect(commentFileHref).not.toContain("undefined");
    await commentLink.focus();
    expect(
      await commentLink.evaluate(
        (element) => document.activeElement === element,
      ),
    ).toBe(true);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    const fixtureImage = editor.getByRole("img", {
      name: "Fixture image",
      exact: true,
    });
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
    const largeImage = editor.getByRole("img", {
      name: "Large fixture image",
    });
    const transparentImage = editor.getByRole("img", {
      name: "Transparent fixture image",
    });
    const brokenImage = editor.getByRole("img", {
      name: "Broken fixture image",
    });
    await expect(largeImage).toHaveAttribute(
      "src",
      MARKDOWN_FIXTURE_LARGE_IMAGE_PATH,
    );
    await expect(transparentImage).toHaveAttribute(
      "src",
      MARKDOWN_FIXTURE_TRANSPARENT_IMAGE_PATH,
    );
    await expect(brokenImage).toHaveAccessibleName(/Broken fixture image/u);
    await expect
      .poll(() =>
        largeImage.evaluate(
          (image: HTMLImageElement) =>
            image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
        ),
      )
      .toBe(true);
    const imageGeometry = await editor.evaluate((root: HTMLElement) => {
      const read = (selector: string) => {
        const image = root.querySelector<HTMLImageElement>(selector);
        if (!image) return null;
        const rect = image.getBoundingClientRect();
        const styles = getComputedStyle(image);
        return {
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          renderedWidth: rect.width,
          renderedHeight: rect.height,
          maxWidth: styles.maxWidth,
          maxHeight: styles.maxHeight,
          objectFit: styles.objectFit,
          display: styles.display,
          marginBlockStart: styles.marginBlockStart,
          marginBlockEnd: styles.marginBlockEnd,
          background: styles.backgroundColor,
          border: styles.borderTopColor,
          radius: styles.borderTopLeftRadius,
        };
      };
      return {
        small: read('img[alt="Fixture image"]'),
        large: read('img[alt="Large fixture image"]'),
        transparent: read('img[alt="Transparent fixture image"]'),
        broken: read('img[alt="Broken fixture image"]'),
      };
    });
    expect(imageGeometry.small).toMatchObject({
      naturalWidth: 96,
      naturalHeight: 48,
      maxWidth: "100%",
      maxHeight: "512px",
      objectFit: "contain",
      display: "block",
      marginBlockStart: "16px",
      marginBlockEnd: "16px",
    });
    expect(imageGeometry.small?.renderedWidth).toBeLessThanOrEqual(98);
    expect(imageGeometry.large).toMatchObject({
      naturalWidth: 1600,
      naturalHeight: 1200,
      maxHeight: "512px",
      objectFit: "contain",
      display: "block",
    });
    expect(imageGeometry.large?.renderedHeight).toBeLessThanOrEqual(514);
    expect(imageGeometry.transparent).toMatchObject({
      naturalWidth: 320,
      naturalHeight: 180,
      background: imageGeometry.small?.background,
      border: imageGeometry.small?.border,
      radius: imageGeometry.small?.radius,
    });
    expect(imageGeometry.broken).toMatchObject({
      maxWidth: "100%",
      maxHeight: "512px",
      display: "none",
      marginBlockStart: "16px",
      marginBlockEnd: "16px",
    });

    const fileLink = editor.getByRole("link", { name: "incident.log" });
    await expect(fileLink).toHaveAttribute(
      "data-markdown-target",
      MARKDOWN_FIXTURE_FILE_URI,
    );
    await expect(fileLink).toHaveAttribute(
      "data-markdown-resolution",
      "available",
    );
    const fileProxyHref = await fileLink.getAttribute("href");
    if (!fileProxyHref)
      throw new Error("Markdown fixture file link has no href");
    expect(fileProxyHref).not.toContain(MARKDOWN_FIXTURE_FILE_URI);
    const fileProxyUrl = expectMarkdownFileProxyUrl(fileProxyHref, page.url());
    const fileResponse = await page.request.get(fileProxyUrl.toString());
    expect(fileResponse.status()).toBe(200);
    expect(fileResponse.headers()["content-type"]).toContain("text/plain");
    expect(fileResponse.headers()["content-disposition"]).toContain(
      "attachment",
    );
    expect(await fileResponse.text()).toContain("fixture incident log");
    const issueReference = editor.locator(
      '[data-markdown-reference-runtime-url="/workspace/reef-e2e/issues/REEF-002"][role="link"]',
    );
    await expect(issueReference).toHaveCount(1);
    await expect(issueReference).toHaveRole("link");
    await expect(issueReference).toContainText("REEF-002");
    await expect(issueReference).toHaveAccessibleName(
      "REEF-002 Alpha follow-up",
    );
    await expect(issueReference).toBeVisible();
    expect(
      await issueReference.evaluate(
        (element) => window.getComputedStyle(element, "::after").content,
      ),
    ).toBe('"Alpha follow-up"');
    await expect(issueReference).toHaveAttribute(
      "data-markdown-reference-runtime-url",
      "/workspace/reef-e2e/issues/REEF-002",
    );
    await expect(issueReference).toHaveAttribute(
      "data-markdown-reference-title",
      "Alpha follow-up",
    );
    await expect(issueReference).toHaveAttribute(
      "title",
      "REEF-002 — Alpha follow-up",
    );
    expect(await issueReference.getAttribute("href")).toBeNull();
    expect(await issueReference.getAttribute("target")).toBeNull();
    expect(await issueReference.getAttribute("rel")).toBeNull();
    const documentReference = editor.locator(
      'a[data-markdown-target*="/doc/"]',
    );
    await expect(documentReference).toHaveAttribute(
      "data-markdown-target",
      "akb://reef-e2e/coll/docs/doc/spec-overview.md",
    );
    await expect(documentReference).toHaveAttribute(
      "data-markdown-resolution",
      "available",
    );

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
      await expect(commentRenderer).toBeVisible();

      const surface = await readMarkdownSurface(editor);
      const commentSurface = await readCommentMarkdownSurface(commentRenderer);
      expect(surface.counts).toMatchObject({
        headings: 3,
        paragraphs: expect.any(Number),
        strong: 2,
        emphasis: 2,
        links: 1,
        akbLinks: 1,
        inlineCode: 2,
        strikethrough: 2,
        nestedStrikethrough: 1,
        orderedLists: 4,
        unorderedLists: 4,
        taskLists: 2,
        checkboxes: 3,
        checkedCheckboxes: 2,
        quotes: 1,
        quoteParagraphs: 2,
        quoteLists: 1,
        quoteNestedOrderedLists: 1,
        codeBlocks: 1,
        rules: 1,
        images: 4,
        fileLinks: 1,
        tables: 1,
      });
      expect(surface.colors.body).toBe(surface.colors.foreground);
      expect(surface.colors.heading).toBe(surface.colors.foreground);
      expect(surface.colors.link).toBe(surface.colors.brand);
      expect(commentSurface.counts).toMatchObject({
        headings: 3,
        paragraphs: expect.any(Number),
        strong: expect.any(Number),
        emphasis: expect.any(Number),
        links: expect.any(Number),
        inlineCode: expect.any(Number),
        strikethrough: expect.any(Number),
        orderedLists: expect.any(Number),
        unorderedLists: expect.any(Number),
        taskLists: 1,
        checkboxes: 3,
        checkedCheckboxes: 2,
        quotes: 1,
        codeBlocks: 1,
        rules: 1,
        images: 4,
        tables: 1,
        mentions: 1,
      });
      expect(commentSurface.colors.body).toBe(commentSurface.colors.foreground);
      expect(commentSurface.colors.heading).toBe(
        commentSurface.colors.foreground,
      );
      expect(commentSurface.colors.link).toBe(commentSurface.colors.brand);
      expect(commentSurface.colors.linkDecoration).toBe(
        commentSurface.colors.brand,
      );
      expect(commentSurface.colors.mention).toBe(commentSurface.colors.brand);
      expect(commentSurface.colors.inlineCode).toBe(
        commentSurface.colors.foreground,
      );
      expect(commentSurface.colors.inlineCodeBackground).toBe(
        commentSurface.colors.surfaceSubtle,
      );
      expect(commentSurface.colors.inlineCodeBorder).toBe(
        commentSurface.colors.borderSubtle,
      );
      expect(commentSurface.colors.codeBackground).toBe(
        commentSurface.colors.surfaceSubtle,
      );
      expect(commentSurface.colors.codeBorder).toBe(
        commentSurface.colors.borderSubtle,
      );
      expect(commentSurface.colors.codeOverflowX).toBe("auto");
      expect(commentSurface.colors.codeWhiteSpace).toBe("pre");
      expect(commentSurface.colors.tableBorder).toBe(
        commentSurface.colors.borderSubtle,
      );
      expect(commentSurface.typography).toEqual({
        fontSize: "13px",
        lineHeight: "20px",
      });
      expect(commentSurface.overflow).toMatchObject({
        comment: true,
        codeBlock: true,
        codeBlockContained: true,
        table: true,
        images: true,
        document: true,
      });
      expect(surface.normalListMetrics).toHaveLength(8);
      for (const list of surface.normalListMetrics) {
        expect(list.paddingInlineStart).toBe("20px");
        expect(list.marker).toBe(surface.colors.mutedForeground);
        expect(list.directParagraphMargin).toBe("0px");
      }
      expect(
        surface.normalListMetrics
          .filter((list) => list.siblingGap !== null)
          .map((list) => list.siblingGap),
      ).toEqual(expect.arrayContaining([4]));
      expect(surface.taskItemMetrics).toHaveLength(3);
      expect(surface.taskItemMetrics).toEqual([
        expect.objectContaining({
          checked: "true",
          checkboxWidth: "16px",
          checkboxHeight: "16px",
          accentColor: surface.colors.brandGlyph,
          bodyColor: surface.colors.mutedForeground,
          bodyDecoration: "line-through",
        }),
        expect.objectContaining({
          checked: "false",
          checkboxWidth: "16px",
          checkboxHeight: "16px",
          accentColor: surface.colors.brandGlyph,
          bodyColor: surface.colors.foreground,
          bodyDecoration: "none",
        }),
        expect.objectContaining({
          checked: "true",
          checkboxWidth: "16px",
          checkboxHeight: "16px",
          accentColor: surface.colors.brandGlyph,
          bodyColor: surface.colors.mutedForeground,
          bodyDecoration: "line-through",
        }),
      ]);
      for (const taskItem of surface.taskItemMetrics) {
        expect(taskItem.firstRowCenterDelta).toBeLessThanOrEqual(4);
      }
      expect(surface.colors.akbLinkTarget).toBe(
        "akb://reef-e2e/coll/docs/doc/spec-overview.md",
      );
      expect(surface.colors.linkDecoration).toBe(surface.colors.brand);
      expect(surface.colors.linkDecorationLine).toContain("underline");
      expect(surface.colors.linkDecorationThickness).toBe("1px");
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
      expect(surface.colors.quoteBorder).toBe(surface.colors.brandFocus);
      expect(surface.colors.quoteBorderWidth).toBe("2px");
      expect(surface.colors.quoteBackground).toBe(surface.colors.surfaceSubtle);
      expect(surface.colors.quoteFontStyle).toBe("normal");
      expect(surface.colors.quoteFontWeight).toBe("400");
      expect(surface.colors.quotePaddingBlock).toBe("8px");
      expect(surface.colors.quotePaddingInline).toBe("12px");
      expect(surface.colors.quoteFirstChildMarginTop).toBe("0px");
      expect(surface.colors.quoteLastChildMarginBottom).toBe("0px");
      expect(surface.colors.preCode).toBe(surface.colors.foreground);
      expect(surface.colors.preCodeFontFamily).toContain("Geist Mono");
      expect(surface.colors.preCodeFontSize).toBe("13px");
      expect(surface.colors.preCodeLineHeight).toBe("20px");
      expect(surface.colors.preCodeWhiteSpace).toBe("pre");
      expect(surface.colors.preCodeLanguage).toContain("language-ts");
      expect(surface.colors.preBackground).toBe(surface.colors.surfaceSubtle);
      expect(surface.colors.preBorder).toBe(surface.colors.borderSubtle);
      expect(surface.colors.preRadius).toBe("6px");
      expect(surface.colors.prePaddingInline).toBe("14px");
      expect(surface.colors.prePaddingBlock).toBe("12px");
      expect(surface.colors.preOverflowX).toBe("auto");
      expect(surface.colors.preWhiteSpace).toBe("pre");
      expect(surface.colors.ruleBorder).toBe(surface.colors.borderSubtle);
      expect(surface.colors.ruleBorderWidth).toBe("1px");
      expect(surface.colors.ruleBorderStyle).toBe("solid");
      expect(surface.colors.ruleMarginBlock).toEqual({
        start: "24px",
        end: "24px",
      });
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
      expect(surface.overflow).toEqual({
        editor: true,
        codeBlock: true,
        codeBlockContained: true,
        document: true,
      });

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
      const source = page.locator('[data-markdown-mode="source"] textarea');
      await expect(source).toBeVisible();
      const sourceMarkdown = await source.inputValue();
      expect(sourceMarkdown).toContain("# Markdown reference");
      expect(sourceMarkdown).toContain("한국어 문서와 English notes");
      expect(sourceMarkdown).toContain("## Structure");
      expect(sourceMarkdown).toContain("### Details");
      expect(sourceMarkdown).toContain("@alice");
      expect(sourceMarkdown).toContain("and @alice. Known issue REEF-002;");
      expect(sourceMarkdown).not.toContain("Mention @alice");
      expect(sourceMarkdown).not.toContain("Alice Example");
      expect(sourceMarkdown).not.toContain("Alpha follow-up");
      expect(sourceMarkdown).not.toContain(
        "/workspace/reef-e2e/issues/REEF-002",
      );
      expect(sourceMarkdown).toContain("REEF-002");
      expect(sourceMarkdown).toContain("REEF-999");
      expect(sourceMarkdown).toContain("\\REEF-002");
      expect(sourceMarkdown).toContain("~~strikethrough~~");
      expect(sourceMarkdown).toContain("nested emphasis");
      expect(sourceMarkdown).toContain(
        "akb://reef-e2e/coll/docs/doc/spec-overview.md",
      );
      expect(sourceMarkdown).toContain(MARKDOWN_FIXTURE_LARGE_IMAGE_PATH);
      expect(sourceMarkdown).toContain(MARKDOWN_FIXTURE_TRANSPARENT_IMAGE_PATH);
      expect(sourceMarkdown).toContain(
        "/api/e2e/assets/reef-markdown-editor-missing.png",
      );
      expect(sourceMarkdown).toContain(MARKDOWN_FIXTURE_FILE_URI);
      expect(sourceMarkdown).toContain("```ts");
      expect(sourceMarkdown).toContain("intentionallyLongLine");
      expect(sourceMarkdown).toContain("A second quoted paragraph");
      expect(sourceMarkdown).toContain("Nested unordered item");
      expect(sourceMarkdown).toContain("Nested ordered child");
      expect(sourceMarkdown).toContain("- [x] Completed parent");
      expect(sourceMarkdown).toContain("- [ ] Open child");
      expect(sourceMarkdown).toContain("- [x] Completed child");
      expect(sourceMarkdown).toContain("---");
      expect(sourceMarkdown).toMatch(/^\| Pattern\s+\| Meaning\s+\|$/mu);
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
        inlineCode: 2,
        strikethrough: 2,
        nestedStrikethrough: 1,
        orderedLists: 4,
        unorderedLists: 4,
        quoteParagraphs: 2,
        quoteLists: 1,
        quoteNestedOrderedLists: 1,
        taskLists: 2,
        checkboxes: 3,
        checkedCheckboxes: 2,
        quotes: 1,
        codeBlocks: 1,
        rules: 1,
        images: 4,
        fileLinks: 1,
        tables: 1,
      });
      expect(roundTrip.text).toContain("@alice");
      expect(roundTrip.text).toContain("nested emphasis");
      expect(roundTrip.blockOrder).toEqual(surface.blockOrder);
    }

    await commentRenderer.scrollIntoViewIfNeeded();
    await expect(commentRenderer).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: testInfo.outputPath("desktop-1440x900-body-comment.png"),
    });
    await page.setViewportSize({ width: 1024, height: 800 });
    await commentRenderer.scrollIntoViewIfNeeded();
    await expect(commentRenderer).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: testInfo.outputPath("narrow-1024x800-body-comment.png"),
    });
    await page.setViewportSize({ width: 1440, height: 900 });

    // Commit a harmless source-only marker, reload the real issue detail, and
    // verify the media/file source and rendered affordances survive the server
    // round-trip. This exercises the existing body autosave boundary without
    // changing the fixture's authored links or attachment data.
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const saveSource = page.locator('[data-markdown-mode="source"] textarea');
    const persistedMarker =
      "\n\nreef-517 save round-trip marker\n\nResolved reference after reload: REEF-002";
    const sourceBeforeSave = await saveSource.inputValue();
    const persistedSource = `${sourceBeforeSave}${persistedMarker}`;
    const saveResponse = waitForIssueContentSave(
      page,
      "REEF-001",
      persistedSource,
    );
    await saveSource.fill(persistedSource);
    await page.getByTestId("issue-title-input").click();
    const persistedResponse = await saveResponse;
    expect(
      persistedResponse.ok(),
      `body save failed with ${persistedResponse.status()}`,
    ).toBeTruthy();
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === REEF_E2E_VAULT)
          ?.documents.find((document) => document.path.startsWith("issues/"))
          ?.content;
      })
      .toBe(persistedSource);

    const refreshedIssueResponse = page.waitForResponse((response) => {
      const request = response.request();
      return (
        new URL(response.url()).pathname === "/api/issues/REEF-001" &&
        request.method() === "GET"
      );
    });
    await page.reload();
    const refreshedIssue = await refreshedIssueResponse;
    expect(refreshedIssue.ok()).toBeTruthy();
    const refreshedDocument = (await refreshedIssue.json()) as {
      content?: string;
    };
    expect(refreshedDocument.content).toContain(persistedMarker.trim());
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    const reopenedEditor = page.locator(".reef-markdown-editor");
    await expect(reopenedEditor).toBeVisible();
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const reopenedSource = page.locator(
      '[data-markdown-mode="source"] textarea',
    );
    await expect
      .poll(() => reopenedSource.inputValue())
      .toContain(persistedMarker.trim());
    const reopenedMarkdown = await reopenedSource.inputValue();
    expect(reopenedMarkdown).toContain(persistedMarker.trim());
    expect(reopenedMarkdown).toContain(MARKDOWN_FIXTURE_LARGE_IMAGE_PATH);
    expect(reopenedMarkdown).toContain(MARKDOWN_FIXTURE_TRANSPARENT_IMAGE_PATH);
    expect(reopenedMarkdown).toContain(MARKDOWN_FIXTURE_FILE_URI);
    expect(reopenedMarkdown).toContain("REEF-002");
    expect(reopenedMarkdown).toContain("and @alice. Known issue REEF-002;");
    expect(reopenedMarkdown).not.toContain("Mention @alice");
    expect(reopenedMarkdown).not.toContain("Alpha follow-up");
    expect(reopenedMarkdown).not.toContain(
      "/workspace/reef-e2e/issues/REEF-002",
    );
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    await expect(
      reopenedEditor.locator('img[data-markdown-image="true"]'),
    ).toHaveCount(4);
    const reopenedFileLink = reopenedEditor.getByRole("link", {
      name: "incident.log",
    });
    await expect(reopenedFileLink).toHaveAttribute(
      "data-markdown-target",
      MARKDOWN_FIXTURE_FILE_URI,
    );
    const reopenedIssueReference = reopenedEditor.locator(
      '[data-markdown-reference-runtime-url="/workspace/reef-e2e/issues/REEF-002"][role="link"]',
    );
    await expect(reopenedIssueReference).toHaveCount(2);
    for (const reference of await reopenedIssueReference.all()) {
      await expect(reference).toHaveAttribute(
        "data-markdown-reference-runtime-url",
        "/workspace/reef-e2e/issues/REEF-002",
      );
      await expect(reference).toHaveAttribute(
        "data-markdown-reference-title",
        "Alpha follow-up",
      );
      await expect(reference).toBeVisible();
      expect(
        await reference.evaluate(
          (element) => window.getComputedStyle(element, "::after").content,
        ),
      ).toBe('"Alpha follow-up"');
      await expect(reference).toHaveAttribute(
        "title",
        "REEF-002 — Alpha follow-up",
      );
      await expect(reference).toHaveAccessibleName("REEF-002 Alpha follow-up");
      await expect(reference).toHaveRole("link");
      expect(await reference.getAttribute("href")).toBeNull();
      expect(await reference.getAttribute("target")).toBeNull();
      expect(await reference.getAttribute("rel")).toBeNull();
    }
    const reopenedFileHref = await reopenedFileLink.getAttribute("href");
    if (!reopenedFileHref)
      throw new Error("Reopened Markdown fixture file link has no href");
    expectMarkdownFileProxyUrl(reopenedFileHref, page.url());

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("keeps rendered AKB targets out of Source serialization", async ({
    page,
    request,
  }) => {
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const source = page.locator('[data-markdown-mode="source"] textarea');
    const planUri = "akb://reef-e2e/coll/docs/doc/spec-overview.md";
    const customUri = "akb://reef-e2e/coll/docs/doc/alpha-reference.md";
    const authoredMarkdown = [
      String.raw`[\[Plan\] 260811 - 전체](${planUri})`,
      `[Custom title](${customUri})`,
    ].join("\n\n");

    await source.fill(authoredMarkdown);
    await expect(source).toHaveValue(authoredMarkdown);
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();

    const planLink = editor.getByRole("link", {
      name: "[Plan] 260811 - 전체",
    });
    const customLink = editor.getByRole("link", { name: "Custom title" });
    await expect(planLink).toHaveAttribute(
      "href",
      "https://akb.e2e.test/vault/reef-e2e/doc/docs%2Fspec-overview.md",
    );
    await expect(customLink).toHaveAttribute(
      "href",
      "https://akb.e2e.test/vault/reef-e2e/doc/docs%2Falpha-reference.md",
    );
    await expect(planLink).toHaveAttribute("target", "_blank");
    await expect(planLink).toHaveAttribute("rel", /noopener/);
    await expect(planLink).toHaveAttribute("rel", /noreferrer/);

    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    await expect(source).toHaveValue(
      new RegExp(planUri.replaceAll("/", "\\/")),
    );
    await expect(source).toHaveValue(
      new RegExp(customUri.replaceAll("/", "\\/")),
    );
    expect(await source.inputValue()).not.toContain(
      "https://akb.e2e.test/vault/",
    );

    const marker = "\n\nserialization boundary marker";
    const persistedSource = `${await source.inputValue()}${marker}`;
    const saveResponse = waitForIssueContentSave(
      page,
      "REEF-001",
      persistedSource,
    );
    await source.fill(persistedSource);
    await page.getByTestId("issue-title-input").click();
    const persistedResponse = await saveResponse;
    expect(persistedResponse.ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const reopenedSource = page.locator(
      '[data-markdown-mode="source"] textarea',
    );
    await expect(reopenedSource).toHaveValue(
      new RegExp(planUri.replaceAll("/", "\\/")),
    );
    await expect(reopenedSource).toHaveValue(
      new RegExp(customUri.replaceAll("/", "\\/")),
    );
    expect(await reopenedSource.inputValue()).not.toContain(
      "https://akb.e2e.test/vault/",
    );
  });

  test("aligns safe external links and known issue references across body and comments", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    const comment = page.locator(".reef-markdown-comment").first();
    const bodyExternalLink = editor.getByRole("link", { name: "reef link" });
    const commentExternalLink = comment.getByRole("link", {
      name: "reef link",
    });
    const commentIssueReferences = comment.getByRole("link", {
      name: "REEF-002",
      exact: true,
    });

    await expect(bodyExternalLink).toHaveAttribute(
      "href",
      "https://example.com/reef",
    );
    await expect(commentExternalLink).toHaveAttribute(
      "href",
      "https://example.com/reef",
    );
    await expect(commentIssueReferences).toHaveCount(2);
    for (const reference of await commentIssueReferences.all()) {
      await expect(reference).toHaveAttribute(
        "href",
        "/workspace/reef-e2e/issues/REEF-002",
      );
      await expect(reference).toHaveAttribute("data-reference-kind", "issue");
      await expect(reference).toHaveAttribute("data-issue-id", "REEF-002");
    }

    for (const link of [bodyExternalLink, commentExternalLink]) {
      const pageCount = page.context().pages().length;
      await link.click();
      const dialog = page.getByRole("dialog", {
        name: "Open external link",
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("https://example.com/reef");
      expect(page.context().pages()).toHaveLength(pageCount);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).not.toBeVisible();
    }
  });

  test("contains the long code line at an effective 200% viewport", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await expect(editor).toBeVisible();
    const surface = await readMarkdownSurface(editor);
    expect(surface.overflow).toMatchObject({
      editor: true,
      codeBlock: true,
      codeBlockContained: true,
      document: true,
    });
    expect(surface.colors.preCodeLanguage).toContain("language-ts");
    expect(surface.colors.preCodeWhiteSpace).toBe("pre");

    const geometry = await editor.evaluate((root: HTMLElement) => {
      const pre = root.querySelector<HTMLElement>("pre");
      return {
        editorClientWidth: root.clientWidth,
        editorScrollWidth: root.scrollWidth,
        preClientWidth: pre?.clientWidth ?? 0,
        preScrollWidth: pre?.scrollWidth ?? 0,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(geometry.preScrollWidth).toBeGreaterThan(geometry.preClientWidth);
    expect(geometry.editorScrollWidth).toBeLessThanOrEqual(
      geometry.editorClientWidth,
    );
    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(
      geometry.documentClientWidth,
    );

    const commentRenderer = page.locator(".reef-markdown-comment").first();
    await expect(commentRenderer).toBeVisible();
    await commentRenderer.scrollIntoViewIfNeeded();
    await expect(
      commentRenderer.locator('[data-streamdown="code-block-body"]'),
    ).toHaveCount(1);
    await expect
      .poll(() =>
        commentRenderer
          .locator('[data-streamdown="code-block-body"]')
          .evaluate(
            (element: HTMLElement) => element.scrollWidth > element.clientWidth,
          ),
      )
      .toBe(true);
    const commentSurface = await readCommentMarkdownSurface(commentRenderer);
    expect(commentSurface.typography).toEqual({
      fontSize: "13px",
      lineHeight: "20px",
    });
    expect(commentSurface.overflow).toMatchObject({
      comment: true,
      codeBlock: true,
      codeBlockContained: true,
      table: true,
      images: true,
      document: true,
    });
    const commentLink = commentRenderer
      .locator('[data-streamdown="link"], a')
      .first();
    await commentLink.focus();
    expect(
      await commentLink.evaluate(
        (element) => document.activeElement === element,
      ),
    ).toBe(true);

    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const source = page.locator('[data-markdown-mode="source"] textarea');
    await expect(source).toBeVisible();
    const sourceMarkdown = await source.inputValue();
    expect(sourceMarkdown).toContain("```ts");
    expect(sourceMarkdown).toContain("intentionallyLongLine");
    expect(sourceMarkdown).toContain("Nested unordered item");
    expect(sourceMarkdown).toContain("Nested ordered child");
    expect(sourceMarkdown).toContain("---");

    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    await expect(editor).toBeVisible();
    const roundTrip = await readMarkdownSurface(editor);
    expect(roundTrip.counts).toMatchObject({
      quotes: 1,
      quoteParagraphs: 2,
      quoteLists: 1,
      quoteNestedOrderedLists: 1,
      codeBlocks: 1,
      rules: 1,
    });
    expect(roundTrip.overflow).toMatchObject({
      editor: true,
      codeBlock: true,
      codeBlockContained: true,
      document: true,
    });
  });

  test("opens the bounded categorized slash menu and round-trips a basic table", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("/");

    const menu = page.locator(".markdown-slash-command-popup");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option")).toHaveCount(10);
    await expect(menu.getByRole("region")).toHaveCount(3);
    await expect(menu.locator("input")).toHaveCount(0);
    await expect(
      menu.getByRole("option").filter({ hasText: /reef/iu }),
    ).toHaveCount(0);
    await expect(editor).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.type("table");
    await expect(menu.getByRole("option")).toHaveCount(1);
    const tableOption = menu.getByRole("option", { name: /^Table\b/u });
    await expect(tableOption).toBeVisible();
    await tableOption.click();
    await expect(menu).toHaveCount(0);

    await expect(editor.locator("table")).toHaveCount(1);
    await expect(editor.locator("table tr")).toHaveCount(3);
    await expect(editor.locator("table th")).toHaveCount(2);
    await expect(editor.locator("table td")).toHaveCount(4);

    const sourceToggle = page
      .getByTestId("markdown-source-toggle")
      .getByRole("button");
    await sourceToggle.click();
    const source = page.locator('[data-markdown-mode="source"] textarea');
    await expect(source).toBeVisible();
    await expect(source).toHaveValue(/\|/u);
    await expect(source).not.toHaveValue(/\//u);

    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/issues/REEF-001") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    );
    await page.getByTestId("issue-title-input").click();
    await saveResponse;

    const sourceMarkdown = await source.inputValue();
    expect(
      sourceMarkdown
        .split(/\r?\n/u)
        .filter((line) => line.trimStart().startsWith("|")),
    ).toHaveLength(4);
    const fixture = await readFixtureState(request);
    const persistedDocument = fixture.vaults
      .find((vault) => vault.name === REEF_E2E_VAULT)
      ?.documents.find((document) => document.title === "REEF-001");
    expect(persistedDocument?.content).toBe(sourceMarkdown);

    await page.reload();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    const reopenedEditor = page.locator(".reef-markdown-editor");
    await expect(reopenedEditor).toBeVisible();
    await expect(reopenedEditor.locator("table")).toHaveCount(1);
    await expect(reopenedEditor.locator("table tr")).toHaveCount(3);
    const reopenedRows = await reopenedEditor
      .locator("table tr")
      .evaluateAll((rows) =>
        rows.map((row) =>
          Array.from(row.children).map((cell) => cell.tagName.toLowerCase()),
        ),
      );
    expect(reopenedRows).toEqual([
      ["th", "th"],
      ["td", "td"],
      ["td", "td"],
    ]);
  });

  test("keeps the create surface placeholder discoverable without saving it", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    await page.getByTestId("issue-close").click();
    await expect(page.getByTestId("issue-detail")).not.toBeVisible();
    await page.getByTestId("new-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    const markdownEditor = dialog.getByTestId("markdown-editor");
    const editor = markdownEditor.locator(".reef-markdown-editor");
    const placeholder = markdownEditor.getByTestId(
      "markdown-editor-placeholder",
    );
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveText(
      "Describe the issue or type / to insert a block…",
    );
    await expect(editor).toBeVisible();
    await expect(editor).toBeEditable();

    const sourceToggle = dialog
      .getByTestId("markdown-source-toggle")
      .getByRole("button");
    await sourceToggle.click();
    const source = dialog.locator('[data-markdown-mode="source"] textarea');
    await expect(source).toHaveValue("");
    await expect(source).toHaveAttribute("placeholder", "Describe the issue…");
    await sourceToggle.click();

    await editor.click();
    await expect(editor).toBeFocused();
    await page.keyboard.type("Body authored in the editor");
    await expect(placeholder).toHaveCount(0);

    await sourceToggle.click();
    await expect(source).toHaveValue("Body authored in the editor");
    await expect(source).not.toHaveValue(
      /Describe the issue or type \/ to insert a block/u,
    );
    await dialog.getByTestId("new-issue-cancel").click();
  });

  test("converges slash selection, keeps keyboard options visible, and layers Escape in New Issue", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page.getByTestId("issue-close").click();

    await page.getByTestId("new-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    const title = dialog.getByTestId("new-issue-title-input");
    await title.fill("Draft slash behavior");

    const editor = dialog.locator(".reef-markdown-editor");
    await editor.click();
    await page.keyboard.type("/");
    const menu = page.locator(".markdown-slash-command-popup");
    await expect(menu).toBeVisible();

    const options = menu.getByRole("option");
    const optionsViewport = menu.locator(".markdown-slash-command-options");
    const selectedCount = () =>
      menu.locator('[role="option"][aria-selected="true"]').count();
    const isSelectedVisible = () =>
      optionsViewport.evaluate((root) => {
        const selected = root.querySelector<HTMLElement>(
          '[role="option"][aria-selected="true"]',
        );
        if (!selected) return false;
        const rootRect = root.getBoundingClientRect();
        const selectedRect = selected.getBoundingClientRect();
        return (
          selectedRect.top >= rootRect.top - 1 &&
          selectedRect.bottom <= rootRect.bottom + 1
        );
      });

    const table = menu.getByRole("option", { name: /^Table\b/u });
    await table.hover();
    await expect(table).toHaveAttribute("aria-selected", "true");
    await expect.poll(selectedCount).toBe(1);
    const tableId = await table.getAttribute("id");
    expect(tableId).toBeTruthy();
    await expect(editor).toHaveAttribute(
      "aria-activedescendant",
      tableId as string,
    );

    const optionCount = await options.count();
    for (let index = 0; index <= optionCount; index += 1) {
      await page.keyboard.press("ArrowDown");
      await expect.poll(selectedCount).toBe(1);
      await expect.poll(isSelectedVisible).toBe(true);
      await expect
        .poll(async () => {
          const activeId = await editor.getAttribute("aria-activedescendant");
          if (!activeId) return null;
          return menu
            .locator(`[id="${activeId}"]`)
            .getAttribute("aria-selected");
        })
        .toBe("true");
      const activeId = await editor.getAttribute("aria-activedescendant");
      expect(activeId).toBeTruthy();
    }

    const bodyBeforeEscape = await editor.textContent();
    await editor.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("discard-draft-confirm")).toHaveCount(0);
    await expect(title).toHaveValue("Draft slash behavior");
    await expect(editor).toHaveText(bodyBeforeEscape ?? "");

    await dialog.press("Escape");
    await expect(page.getByTestId("discard-draft-confirm")).toBeVisible();
    await page.getByTestId("discard-draft-cancel").click();
    await expect(page.getByTestId("discard-draft-confirm")).toHaveCount(0);
  });

  test("keeps the slash menu visible, scrollable, and bounded in the create flow", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    await page.getByTestId("issue-close").click();
    await page.getByTestId("new-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    const editor = dialog.locator(".reef-markdown-editor");
    await editor.click();
    await page.keyboard.type("/");

    const menu = page.locator(".markdown-slash-command-popup");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option")).toHaveCount(10);

    const initialGeometry = await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>(
        ".markdown-slash-command-popup",
      );
      const options = menu?.querySelector<HTMLElement>(
        ".markdown-slash-command-options",
      );
      const trigger = document.querySelector<HTMLElement>(
        '[data-testid="new-issue-dialog"] .reef-markdown-editor p',
      );
      if (!menu || !options || !trigger) {
        throw new Error("Slash menu geometry is unavailable");
      }
      const menuRect = menu.getBoundingClientRect();
      const optionsRect = options.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const visibleOptions = Array.from(
        menu.querySelectorAll<HTMLElement>('[role="option"]'),
      ).filter((option) => {
        const rect = option.getBoundingClientRect();
        return rect.bottom > optionsRect.top && rect.top < optionsRect.bottom;
      }).length;
      return {
        menuRect,
        optionsRect,
        triggerRect,
        visibleOptions,
        optionsOverflowY: getComputedStyle(options).overflowY,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(initialGeometry.visibleOptions).toBeGreaterThanOrEqual(5);
    expect(
      initialGeometry.menuRect.bottom <= initialGeometry.triggerRect.top ||
        initialGeometry.menuRect.top >= initialGeometry.triggerRect.bottom,
    ).toBeTruthy();
    expect(initialGeometry.optionsOverflowY).toBe("auto");
    expect(initialGeometry.documentWidth).toBeLessThanOrEqual(
      initialGeometry.viewportWidth,
    );

    const options = menu.locator(".markdown-slash-command-options");
    await options.hover();
    const optionsBox = await options.boundingBox();
    if (!optionsBox) throw new Error("Slash options geometry is unavailable");
    await page.mouse.move(
      optionsBox.x + optionsBox.width / 2,
      optionsBox.y + optionsBox.height / 2,
    );
    await page.mouse.wheel(0, 600);
    await expect
      .poll(() => options.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    for (let index = 0; index < 9; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    const activeOption = menu.locator('[role="option"][aria-selected="true"]');
    await expect(activeOption).toBeVisible();
    await expect
      .poll(async () =>
        activeOption.evaluate((option) => {
          const options = option.closest<HTMLElement>(
            ".markdown-slash-command-options",
          );
          if (!options) return false;
          const optionRect = option.getBoundingClientRect();
          const optionsRect = options.getBoundingClientRect();
          return (
            optionRect.top >= optionsRect.top &&
            optionRect.bottom <= optionsRect.bottom
          );
        }),
      )
      .toBeTruthy();

    const scrollBefore = await dialog.evaluate((element) => {
      const scrollable = element as HTMLElement;
      const maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
      const nextScroll = Math.min(maxScroll, 64);
      scrollable.scrollTop = nextScroll;
      return nextScroll;
    });
    if (scrollBefore > 0) {
      await expect.poll(() => menu.count()).toBeLessThanOrEqual(1);
      if (await menu.count()) {
        await expect(activeOption).toBeVisible();
      }
    }

    await page.setViewportSize({ width: 390, height: 720 });
    await dialog.evaluate((element) => {
      (element as HTMLElement).scrollTop = 0;
    });
    if (!(await menu.count())) {
      await editor.click();
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.type("/");
    }
    await expect(menu).toBeVisible();
    let narrowGeometry:
      | {
          left: number;
          right: number;
          documentWidth: number;
          viewportWidth: number;
        }
      | undefined;
    await expect
      .poll(
        async () => {
          narrowGeometry = await menu.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              documentWidth: document.documentElement.scrollWidth,
              viewportWidth: window.innerWidth,
            };
          });
          return (
            narrowGeometry.left >= 8 &&
            narrowGeometry.right <= narrowGeometry.viewportWidth - 8 &&
            narrowGeometry.documentWidth <= narrowGeometry.viewportWidth
          );
        },
        { message: "Slash menu settles inside the narrow viewport" },
      )
      .toBe(true);
    if (!narrowGeometry) {
      throw new Error("Slash menu narrow geometry was not observed");
    }
    expect(narrowGeometry.left).toBeGreaterThanOrEqual(8);
    expect(narrowGeometry.right).toBeLessThanOrEqual(
      narrowGeometry.viewportWidth - 8,
    );
    expect(narrowGeometry.documentWidth).toBeLessThanOrEqual(
      narrowGeometry.viewportWidth,
    );

    await dialog.getByTestId("new-issue-cancel").click();
  });

  test("uses the categorized @ menu for all four reference kinds and saves canonical links", async ({
    page,
    request,
  }) => {
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("@a");

    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await expect(editor).toHaveAttribute("aria-expanded", "true");
    await expect(listbox.getByRole("region", { name: "People" })).toBeVisible();
    await expect(listbox.getByRole("region", { name: "Issues" })).toBeVisible();
    await expect(
      listbox.getByRole("region", { name: "Documents" }),
    ).toBeVisible();

    await expect(
      listbox
        .getByRole("region", { name: "People" })
        .getByRole("option")
        .filter({ hasText: "alice" }),
    ).toBeVisible();
    await expect(
      listbox
        .getByRole("region", { name: "Issues" })
        .getByRole("option")
        .filter({ hasText: "REEF-002" }),
    ).toBeVisible();
    await expect(
      listbox
        .getByRole("region", { name: "Documents" })
        .getByRole("option")
        .filter({ hasText: "Alpha reference" }),
    ).toBeVisible();

    const chooseWithKeyboard = async (option: Locator) => {
      const optionId = await option.getAttribute("id");
      expect(optionId).toBeTruthy();
      const optionCount = await listbox.getByRole("option").count();
      for (let index = 0; index < optionCount; index += 1) {
        if ((await editor.getAttribute("aria-activedescendant")) === optionId) {
          break;
        }
        await editor.press("ArrowDown");
      }
      await expect(editor).toHaveAttribute(
        "aria-activedescendant",
        optionId as string,
      );
      await editor.press("Enter");
      await expect(listbox).toHaveCount(0);
      await expect(editor).toBeFocused();
    };

    const personOption = listbox
      .getByRole("region", { name: "People" })
      .getByRole("option")
      .filter({ hasText: "alice" });
    await chooseWithKeyboard(personOption);
    await page.keyboard.type(" continued");

    await page.keyboard.press("Enter");
    await page.keyboard.type("@a");
    await expect(listbox).toBeVisible();
    await listbox
      .getByRole("region", { name: "Issues" })
      .getByRole("option")
      .filter({ hasText: "REEF-002" })
      .click();
    await expect(editor).toBeFocused();

    await page.keyboard.press("Enter");
    await page.keyboard.type("@alpha");
    await expect(listbox).toBeVisible();
    await listbox
      .getByRole("region", { name: "Documents" })
      .getByRole("option")
      .filter({ hasText: "Alpha reference" })
      .click();
    await expect(listbox).toHaveCount(0);
    await expect(editor).toBeFocused();

    await page.keyboard.press("Enter");
    await page.keyboard.type("@incident");
    await expect(listbox).toBeVisible();
    const fileOption = listbox
      .getByRole("region", { name: "Files" })
      .getByRole("option")
      .filter({ hasText: "incident.log" });
    await expect(fileOption).toBeVisible();
    await chooseWithKeyboard(fileOption);

    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const source = page.locator('[data-markdown-mode="source"] textarea');
    const finalMarkdown = await source.inputValue();
    expect(finalMarkdown).toContain("@alice");
    expect(finalMarkdown).toContain("REEF-002");
    expect(finalMarkdown).toContain(
      "[Alpha reference](akb://reef-e2e/coll/docs/doc/alpha-reference.md)",
    );
    expect(finalMarkdown).toContain(
      `[incident.log](${MARKDOWN_FIXTURE_FILE_URI})`,
    );
    expect(finalMarkdown).not.toContain("/api/files?");
    expect(finalMarkdown).not.toContain("https://akb.e2e.test/vault/");

    const saveResponse = page.waitForResponse((response) => {
      const request = response.request();
      if (
        new URL(response.url()).pathname !== "/api/issues/REEF-001" ||
        request.method() !== "PATCH"
      ) {
        return false;
      }
      const body = request.postDataJSON() as {
        update?: { content?: unknown };
      };
      return body.update?.content === finalMarkdown;
    });
    await page.getByTestId("issue-title-input").click();
    const saved = await saveResponse;
    expect(saved.ok(), `save failed with ${saved.status()}`).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const reopenedSource = page.locator(
      '[data-markdown-mode="source"] textarea',
    );
    const reopenedMarkdown = await reopenedSource.inputValue();
    expect(normalizeAdjacentImageOnlyBlocks(reopenedMarkdown)).toBe(
      normalizeAdjacentImageOnlyBlocks(finalMarkdown),
    );

    const state = await readFixtureState(request);
    const calls = state.calls ?? [];
    expect(
      calls.some(
        (call) =>
          call.method === "POST" && call.path.includes("/api/v1/relations"),
      ),
    ).toBe(false);
  });

  test("keeps the @ menu selection unchanged during scripted composition", async ({
    page,
    request,
  }) => {
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("@a");

    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    const aliceOption = listbox
      .getByRole("region", { name: "People" })
      .getByRole("option")
      .filter({ hasText: "alice" });
    await expect(aliceOption).toBeVisible();
    const optionId = await aliceOption.getAttribute("id");
    expect(optionId).toBeTruthy();
    const optionCount = await listbox.getByRole("option").count();
    for (let index = 0; index < optionCount; index += 1) {
      if ((await editor.getAttribute("aria-activedescendant")) === optionId) {
        break;
      }
      await editor.press("ArrowDown");
    }
    await expect(editor).toHaveAttribute(
      "aria-activedescendant",
      optionId as string,
    );

    const textBeforeComposition = await editor.innerText();
    await editor.evaluate((element: HTMLElement) => {
      element.dispatchEvent(
        new CompositionEvent("compositionstart", {
          bubbles: true,
          data: "",
        }),
      );
      element.dispatchEvent(
        new CompositionEvent("compositionupdate", {
          bubbles: true,
          data: "ㅎ",
        }),
      );
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "isComposing", { value: true });
      element.dispatchEvent(event);
    });

    await expect(listbox).toBeVisible();
    await expect(editor).toHaveAttribute(
      "aria-activedescendant",
      optionId as string,
    );
    expect(await editor.innerText()).toBe(textBeforeComposition);

    await editor.dispatchEvent("compositionend", { data: "ㅎ" });
    await editor.press("Enter");
    await expect(listbox).toHaveCount(0);
    await expect(editor).toBeFocused();
  });

  test("creates and reopens a file reference from New Issue Description", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
    await expect(page.getByTestId("issue-list-row").first()).toBeVisible();

    await page.getByTestId("new-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    const title = "New issue reference round trip";
    await dialog.getByTestId("new-issue-title-input").fill(title);

    const editor = dialog.locator(".reef-markdown-editor");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("@incident");

    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    const fileOption = listbox
      .getByRole("region", { name: "Files" })
      .getByRole("option")
      .filter({ hasText: "incident.log" });
    await expect(fileOption).toBeVisible();
    await fileOption.click();
    await expect(editor).toBeFocused();
    await page.keyboard.type(" and continued writing");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("new-issue-title-input")).toHaveValue(
      title,
    );

    await dialog
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const source = dialog.locator('[data-markdown-mode="source"] textarea');
    const createdMarkdown = await source.inputValue();
    expect(createdMarkdown).toContain(
      `[incident.log](${MARKDOWN_FIXTURE_FILE_URI})`,
    );
    expect(createdMarkdown).toContain("and continued writing");
    expect(createdMarkdown).not.toContain("/api/files?");

    const createdIssueResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/issues" && response.request().method() === "POST"
      );
    });
    const issueReadbackResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        /^\/api\/issues\/REEF-\d+$/u.test(url.pathname) &&
        url.searchParams.get("vault") === REEF_E2E_VAULT &&
        response.request().method() === "GET"
      );
    });
    await dialog.getByTestId("new-issue-submit").click();
    const createResponse = await createdIssueResponse;
    expect(
      createResponse.ok(),
      `create failed with ${createResponse.status()}`,
    ).toBeTruthy();
    const createResult = (await createResponse.json()) as {
      issue: { id: string; title: string };
    };
    const issueId = createResult.issue.id;
    expect(issueId).toMatch(/^REEF-\d+$/u);
    const readbackResponse = await issueReadbackResponse;
    expect(new URL(readbackResponse.url()).pathname).toBe(
      `/api/issues/${issueId}`,
    );
    expect(
      readbackResponse.ok(),
      `readback failed with ${readbackResponse.status()}`,
    ).toBeTruthy();
    await page.waitForURL(
      (url) =>
        url.pathname === `/workspace/${REEF_E2E_VAULT}/issues/${issueId}`,
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(page.getByTestId("issue-title-input")).toHaveValue(
      createResult.issue.title,
    );

    const state = await readFixtureState(request);
    const createdDocument = state.vaults
      .find((vault) => vault.name === REEF_E2E_VAULT)
      ?.documents.find(
        (document) => document.path === `issues/${issueId.toLowerCase()}.md`,
      );
    expect(createdDocument?.content).toContain(
      `[incident.log](${MARKDOWN_FIXTURE_FILE_URI})`,
    );

    await page.reload();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const reopenedSource = page.locator(
      '[data-markdown-mode="source"] textarea',
    );
    await expect(reopenedSource).toHaveValue(
      new RegExp(
        `\\[incident\\.log\\]\\(${MARKDOWN_FIXTURE_FILE_URI.replaceAll("/", "\\/")}\\)`,
      ),
    );
    expect(await reopenedSource.inputValue()).not.toContain("/api/files?");
  });

  test("keeps local candidates on resource failures and distinguishes empty from error", async ({
    page,
    request,
  }) => {
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    const listbox = page.getByRole("listbox");
    const issueTitle = await page.getByTestId("issue-title-input").inputValue();
    const personSearchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/documents/search" &&
        url.searchParams.get("q") === "a"
      );
    });
    await setMarkdownLinkSearchControl(request, {
      query: "a",
      failureStatus: 503,
    });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("@a");
    expect((await personSearchResponse).status()).toBe(502);
    await expect(listbox.getByRole("region", { name: "People" })).toBeVisible();
    await expect(listbox.getByRole("region", { name: "Issues" })).toBeVisible();
    await listbox
      .getByRole("region", { name: "People" })
      .getByRole("option")
      .filter({ hasText: "alice" })
      .click();
    await expect(editor).toBeFocused();
    await expect(page.getByTestId("issue-title-input")).toHaveValue(issueTitle);

    await page.keyboard.press("Enter");
    await page.keyboard.type("@zzzz");
    await expect(listbox.getByTestId("markdown-reference-empty")).toBeVisible();
    await expect(editor).toContainText("@zzzz");
    await editor.press("Escape");
    await expect(listbox).toHaveCount(0);

    const referenceCountBeforeError = await editor
      .locator("[data-markdown-reference-runtime-url]")
      .count();
    const failingSearchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/documents/search" &&
        url.searchParams.get("q") === "missing"
      );
    });
    await setMarkdownLinkSearchControl(request, {
      query: "missing",
      failureStatus: 503,
    });
    await editor.press("Enter");
    await page.keyboard.type("@missing");
    expect((await failingSearchResponse).status()).toBe(502);
    await expect(listbox.getByTestId("markdown-reference-error")).toBeVisible();
    await expect(editor).toContainText("@missing");
    await expect(
      editor.locator("[data-markdown-reference-runtime-url]"),
    ).toHaveCount(referenceCountBeforeError);
    await editor.press("Escape");
    await expect(listbox).toHaveCount(0);
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(page.getByTestId("issue-title-input")).toHaveValue(issueTitle);
  });

  test("discards stale and late resource results after query change or Escape", async ({
    page,
    request,
  }) => {
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    const listbox = page.getByRole("listbox");
    await setMarkdownLinkSearchControl(request, {
      query: "alpha",
      delayMs: 700,
    });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("@alpha");
    await waitForMarkdownLinkSearchPending(request, "alpha");
    await expect(
      listbox.getByTestId("markdown-reference-loading"),
    ).toBeVisible();

    await page.keyboard.press("Control+Backspace");
    await page.keyboard.type("incident");
    await expect(
      listbox
        .getByRole("region", { name: "Files" })
        .getByRole("option")
        .filter({ hasText: "incident.log" }),
    ).toBeVisible();
    await waitForMarkdownLinkSearchIdle(request, "alpha");
    await expect(
      listbox
        .getByRole("region", { name: "Documents" })
        .getByRole("option")
        .filter({ hasText: "Alpha reference" }),
    ).toHaveCount(0);

    await editor.press("Escape");
    await expect(listbox).toHaveCount(0);
    await setMarkdownLinkSearchControl(request, {
      query: "late",
      delayMs: 700,
      failureStatus: 503,
    });
    await page.keyboard.type(" @late");
    await waitForMarkdownLinkSearchPending(request, "late");
    const bodyBeforeEscape = await editor.innerText();
    await editor.press("Escape");
    await expect(listbox).toHaveCount(0);
    // Escape aborts the browser request; wait for the fixture's delayed search to drain.
    await waitForMarkdownLinkSearchIdle(request, "late");
    await expect(listbox).toHaveCount(0);
    expect(await editor.innerText()).toBe(bodyBeforeEscape);
    await expect(page.getByTestId("issue-detail")).toBeVisible();
  });

  test("keeps the issue detail open when Escape dismisses the @ menu", async ({
    page,
    request,
  }) => {
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("@");

    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    const readDocumentText = () =>
      editor.evaluate((root) => {
        const document = root.cloneNode(true) as HTMLElement;
        document
          .querySelectorAll("[data-markdown-image-message]")
          .forEach((message) => message.remove());
        return {
          text: document.textContent ?? "",
          imageAltTexts: Array.from(
            document.querySelectorAll<HTMLImageElement>(
              "img[data-markdown-image], img[data-markdown-target]",
            ),
          ).map((image) => image.getAttribute("alt")),
        };
      });
    const bodyBeforeEscape = await readDocumentText();

    await page.keyboard.press("Escape");

    await expect(listbox).toHaveCount(0);
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveAttribute("aria-expanded", "false");
    await expect.poll(readDocumentText).toEqual(bodyBeforeEscape);
  });

  test("does not open the @ menu inside inline code", async ({
    page,
    request,
  }) => {
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("inline");
    await page.keyboard.press("Shift+Home");
    await page.getByRole("button", { name: "Inline code" }).click();

    await page.keyboard.type("@");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.keyboard.type("inline");
    await expect(editor.locator("p code")).toHaveText("@inline");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });

  test("does not open the @ menu for escaped text", async ({
    page,
    request,
  }) => {
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("\\@escaped");
    await expect(page.getByRole("listbox")).toHaveCount(0);

    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("\\\\@escaped");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });

  test("edits one image occurrence and keeps targets through undo and save", async ({
    page,
    request,
  }) => {
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    const toolbar = page.getByRole("toolbar", { name: "Text formatting" });
    const toolbarUndo = toolbar.getByRole("button", { name: "Undo" });
    const toolbarRedo = toolbar.getByRole("button", { name: "Redo" });
    const sourceToggle = page
      .getByTestId("markdown-source-toggle")
      .getByRole("button");
    await sourceToggle.click();
    const source = page.locator('[data-markdown-mode="source"] textarea');
    const authoredMarkdown = [
      "Dialog focus target.",
      `![First duplicate](${MARKDOWN_FIXTURE_IMAGE_PATH})`,
      `![Second duplicate](${MARKDOWN_FIXTURE_IMAGE_PATH})`,
      `![Independent image](${MARKDOWN_FIXTURE_LARGE_IMAGE_PATH})`,
      `[incident.log](${MARKDOWN_FIXTURE_FILE_URI})`,
      Array.from(
        { length: 24 },
        (_, index) => `Source viewport line ${index + 1} stays in flow.`,
      ).join("\n\n"),
    ].join("\n\n");
    await source.fill(authoredMarkdown);

    const imageActionsInSource = page.getByRole("button", {
      name: /^(Edit image description:|Remove image:)/u,
    });
    const sourceMenuCleared = await expect
      .poll(() => countVisible(imageActionsInSource), { timeout: 1000 })
      .toBe(0)
      .then(
        () => true,
        () => false,
      );
    const sourceActionCount = await imageActionsInSource.count();
    const scrollViewport = page.getByTestId("markdown-editor-scroll-viewport");
    const sourceScrollBefore = await readNearestScrollOwner(source);
    const sourceWheelSent = await wheelWithin(
      page,
      source,
      scrollViewport,
      120,
    );
    const sourceScrollAfter = await readNearestScrollOwner(source);
    const sourceScrollFollowsViewport =
      sourceWheelSent &&
      sourceScrollBefore?.testId === "markdown-editor-scroll-viewport" &&
      sourceScrollAfter?.testId === "markdown-editor-scroll-viewport" &&
      sourceScrollAfter.scrollTop > sourceScrollBefore.scrollTop;
    await sourceToggle.click();

    const firstDuplicateAction = page.getByRole("button", {
      name: "Edit image description: First duplicate",
    });
    const imageSamples: Awaited<ReturnType<typeof measureImageMenu>>[] = [];
    for (const alt of [
      "First duplicate",
      "Second duplicate",
      "Independent image",
    ]) {
      const image = editor.getByRole("img", { name: alt, exact: true });
      const action = page.getByRole("button", {
        name: `Edit image description: ${alt}`,
        exact: true,
      });
      await expect
        .poll(() =>
          image.evaluate((element) => {
            const imageElement = element as HTMLImageElement;
            return imageElement.complete && imageElement.naturalWidth > 0;
          }),
        )
        .toBe(true);
      await image.evaluate(async (element) => {
        await (element as HTMLImageElement).decode();
      });
      await image.scrollIntoViewIfNeeded();
      await waitForLayout(page);
      imageSamples.push(await measureImageMenu(image, action));
    }

    const independentImage = editor.getByRole("img", {
      name: "Independent image",
      exact: true,
    });
    const independentImageAction = page.getByRole("button", {
      name: "Edit image description: Independent image",
      exact: true,
    });
    const beforeWheel = await measureImageMenu(
      independentImage,
      independentImageAction,
    );
    const imageWheelSent = await wheelWithin(
      page,
      independentImage,
      scrollViewport,
      120,
    );
    const afterWheel = await measureImageMenu(
      independentImage,
      independentImageAction,
    );
    const menusFollowImages = imageSamples.every(
      (sample) =>
        sample.imageVisible &&
        sample.actionVisible &&
        sample.scrollOwnerTestId === "markdown-editor-scroll-viewport" &&
        sample.horizontalGap !== null &&
        sample.horizontalGap <= 24 &&
        sample.verticalDistance !== null &&
        sample.verticalDistance <= 64,
    );
    const wheelMenuFollowsImage =
      imageWheelSent &&
      beforeWheel.scrollOwnerTestId === "markdown-editor-scroll-viewport" &&
      afterWheel.scrollOwnerTestId === "markdown-editor-scroll-viewport" &&
      beforeWheel.scrollTop !== null &&
      afterWheel.scrollTop !== null &&
      afterWheel.scrollTop > beforeWheel.scrollTop &&
      afterWheel.verticalDistance !== null &&
      afterWheel.verticalDistance <= 64;

    expect(
      sourceMenuCleared &&
        sourceActionCount === 0 &&
        sourceScrollFollowsViewport &&
        menusFollowImages &&
        wheelMenuFollowsImage,
      JSON.stringify(
        {
          sourceMenuCleared,
          sourceActionCount,
          sourceScrollBefore,
          sourceScrollAfter,
          sourceScrollFollowsViewport,
          geometry: imageSamples,
          wheel: {
            imageWheelSent,
            before: beforeWheel,
            after: afterWheel,
            menuFollowsImage: wheelMenuFollowsImage,
          },
        },
        null,
        2,
      ),
    ).toBe(true);

    await editor.focus();
    await page.keyboard.press("Control+End");
    await page
      .getByRole("button", { name: "Edit image description: Second duplicate" })
      .click();
    const editDialog = page.getByRole("dialog", {
      name: "Image description",
    });
    await editDialog
      .getByRole("textbox", { name: "Description" })
      .fill("Second updated");
    await editDialog.getByRole("button", { name: "Save description" }).click();
    await expect(editDialog).toHaveCount(0);
    await expect(editor).toBeFocused();
    await expect(
      page.getByRole("button", {
        name: "Edit image description: Second updated",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Edit image description: Second duplicate",
      }),
    ).toHaveCount(0);
    await expect(firstDuplicateAction).toBeVisible();
    await expect(independentImageAction).toBeVisible();

    await expect(toolbarUndo).toBeEnabled();
    await toolbarUndo.click();
    await expect(
      page.getByRole("button", {
        name: "Edit image description: Second duplicate",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Edit image description: Second updated",
      }),
    ).toHaveCount(0);
    await expect(toolbarRedo).toBeEnabled();
    await toolbarRedo.click();
    await expect(
      page.getByRole("button", {
        name: "Edit image description: Second updated",
      }),
    ).toBeVisible();
    await expect(firstDuplicateAction).toBeVisible();

    await editor.getByText("Dialog focus target.", { exact: true }).click();
    await page.keyboard.press("End");
    await page
      .getByRole("button", { name: "Edit image description: First duplicate" })
      .click();
    const validationDialog = page.getByRole("dialog", {
      name: "Image description",
    });
    const description = validationDialog.getByRole("textbox", {
      name: "Description",
    });
    await description.fill("   ");
    await validationDialog
      .getByRole("button", { name: "Save description" })
      .click();
    await expect(validationDialog.getByRole("alert")).toHaveText(
      "Describe the image so it remains understandable without sight.",
    );

    await description.fill("Cancelled description");
    await page.keyboard.press("Escape");
    await expect(validationDialog).toHaveCount(0);
    await expect(editor).toBeFocused();
    await page.keyboard.type(" Continued after dialog.");
    await expect(editor).toContainText(
      "Dialog focus target. Continued after dialog.",
    );
    await expect(firstDuplicateAction).toBeVisible();

    await page
      .getByRole("button", { name: "Remove image: First duplicate" })
      .click();
    await expect(firstDuplicateAction).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Edit image description: Second updated",
      }),
    ).toBeVisible();
    await expect(independentImageAction).toBeVisible();
    await expect(
      editor.getByRole("link", { name: "incident.log" }),
    ).toHaveAttribute("data-markdown-target", MARKDOWN_FIXTURE_FILE_URI);

    await expect(toolbarUndo).toBeEnabled();
    await toolbarUndo.click();
    await expect(firstDuplicateAction).toBeVisible();
    await expect(toolbarRedo).toBeEnabled();
    await toolbarRedo.click();
    await expect(firstDuplicateAction).toHaveCount(0);

    await sourceToggle.click();
    const finalMarkdown = await source.inputValue();
    expect(finalMarkdown).toContain(
      `![Second updated](${MARKDOWN_FIXTURE_IMAGE_PATH})`,
    );
    expect(finalMarkdown).not.toContain(
      `![First duplicate](${MARKDOWN_FIXTURE_IMAGE_PATH})`,
    );
    expect(finalMarkdown).toContain(
      `[incident.log](${MARKDOWN_FIXTURE_FILE_URI})`,
    );
    expect(finalMarkdown).toContain(
      `![Independent image](${MARKDOWN_FIXTURE_LARGE_IMAGE_PATH})`,
    );
    expect(finalMarkdown).toContain(
      "Dialog focus target. Continued after dialog.",
    );

    const saveResponse = page.waitForResponse((response) => {
      const request = response.request();
      if (
        new URL(response.url()).pathname !== "/api/issues/REEF-001" ||
        request.method() !== "PATCH"
      ) {
        return false;
      }
      const body = request.postDataJSON() as {
        update?: { content?: unknown };
      };
      return body.update?.content === finalMarkdown;
    });
    await page.getByTestId("issue-title-input").click();
    const persistedResponse = await saveResponse;
    expect(persistedResponse.ok()).toBeTruthy();
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === REEF_E2E_VAULT)
          ?.documents.find((document) => document.path.startsWith("issues/"))
          ?.content;
      })
      .toBe(finalMarkdown);

    const calls = (await readFixtureState(request)).calls ?? [];
    expect(
      calls.filter(
        (call) =>
          call.method === "DELETE" &&
          /\/api\/v1\/(?:assets|files)\//u.test(call.path),
      ),
    ).toEqual([]);

    await page.reload();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await sourceToggle.click();
    const reopenedSource = page.locator(
      '[data-markdown-mode="source"] textarea',
    );
    await expect(reopenedSource).toHaveValue(
      new RegExp(
        `!\\[Second updated\\]\\(${MARKDOWN_FIXTURE_IMAGE_PATH.replaceAll("/", "\\/")}\\)`,
        "u",
      ),
    );
    await expect(reopenedSource).not.toHaveValue(/First duplicate/u);
    await expect(reopenedSource).toHaveValue(
      new RegExp(
        `\\[incident\\.log\\]\\(${MARKDOWN_FIXTURE_FILE_URI.replaceAll("/", "\\/")}\\)`,
        "u",
      ),
    );
    await expect(reopenedSource).toHaveValue(
      new RegExp(
        `!\\[Independent image\\]\\(${MARKDOWN_FIXTURE_LARGE_IMAGE_PATH.replaceAll("/", "\\/")}\\)`,
        "u",
      ),
    );
  });

  test("keeps independent task state through keyboard, Source, save, and re-entry", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 720, height: 800 });
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    const checkboxes = editor.locator(
      'ul[data-type="taskList"] input[type="checkbox"]',
    );
    await expect(checkboxes).toHaveCount(3);
    const parent = checkboxes.nth(0);
    await expect(parent).toBeChecked();
    await expect(checkboxes.nth(1)).not.toBeChecked();
    await expect(checkboxes.nth(2)).toBeChecked();

    await editor.focus();
    const controls = editor.locator(
      'a[href], a[data-markdown-reference-runtime-url][role="link"], input[type="checkbox"]:not(:disabled), pre[data-markdown-code][tabindex="0"]',
    );
    const tabsToFirstTask = await controls.evaluateAll((elements) =>
      elements.findIndex((element) =>
        element.matches('input[type="checkbox"]:not(:disabled)'),
      ),
    );
    for (let index = 0; index <= tabsToFirstTask; index += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(parent).toBeFocused();
    await page.keyboard.press("Space");
    await expect(parent).not.toBeChecked();
    await expect(checkboxes.nth(1)).not.toBeChecked();
    await expect(checkboxes.nth(2)).toBeChecked();

    const sourceToggle = page
      .getByTestId("markdown-source-toggle")
      .getByRole("button");
    await sourceToggle.click();
    const source = page.locator('[data-markdown-mode="source"] textarea');
    await expect(source).toBeVisible();
    await expect(source).toHaveValue(/- \[ \] Completed parent/u);
    await expect(source).toHaveValue(/- \[ \] Open child/u);
    await expect(source).toHaveValue(/- \[x\] Completed child/u);

    await sourceToggle.click();
    await expect(editor).toBeVisible();
    await page.getByTestId("issue-title-input").focus();

    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        const vault = state.vaults.find(
          (candidate) => candidate.name === REEF_E2E_VAULT,
        );
        return (
          vault?.documents.find((document) =>
            document.path.startsWith("issues/"),
          )?.content ?? ""
        );
      })
      .toContain("- [ ] Completed parent");

    await page.getByTestId("issue-close").click();
    await expect(page.getByTestId("issue-detail")).not.toBeVisible();
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const reenteredCheckboxes = page
      .locator(".reef-markdown-editor")
      .locator('ul[data-type="taskList"] input[type="checkbox"]');
    await expect(reenteredCheckboxes).toHaveCount(3);
    await expect(reenteredCheckboxes.nth(0)).not.toBeChecked();
    await expect(reenteredCheckboxes.nth(1)).not.toBeChecked();
    await expect(reenteredCheckboxes.nth(2)).toBeChecked();

    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    await expect(
      page.locator('[data-markdown-mode="source"] textarea'),
    ).toHaveValue(/- \[ \] Completed parent/u);
  });

  test("tabs through Markdown links while skipping the mention", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 720, height: 800 });
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await expect(editor).toBeVisible();
    const surface = await readMarkdownSurface(editor);
    const normalLink = editor.getByRole("link", { name: "reef link" });
    const akbLink = editor.getByRole("link", { name: "AKB report" });
    const fileLink = editor.getByRole("link", { name: "incident.log" });
    const issueReference = editor.locator(
      'a[data-markdown-reference-runtime-url="/workspace/reef-e2e/issues/REEF-002"][role="link"]',
    );
    const mention = editor.getByText("@alice", { exact: true });
    const firstTaskCheckbox = editor
      .locator('ul[data-type="taskList"] input[type="checkbox"]')
      .first();

    await expect(mention).not.toHaveRole("link");

    await editor.focus();
    await page.keyboard.press("Tab");
    await expect(normalLink).toBeFocused();
    await expect(normalLink).toHaveCSS("outline-width", "2px");
    await expect(normalLink).toHaveCSS(
      "outline-color",
      surface.colors.brandFocus,
    );

    await page.keyboard.press("Tab");
    await expect(akbLink).toBeFocused();
    await expect(akbLink).toHaveAttribute(
      "data-markdown-resolution",
      "available",
    );
    await expect(akbLink).toHaveCSS("outline-width", "2px");
    await expect(akbLink).toHaveCSS("outline-color", surface.colors.brandFocus);

    await page.keyboard.press("Tab");
    await expect(issueReference).toBeFocused();
    await expect(issueReference).toHaveCSS("outline-width", "2px");
    await expect(issueReference).toHaveCSS(
      "outline-color",
      surface.colors.brandFocus,
    );

    await page.keyboard.press("Tab");
    await expect(firstTaskCheckbox).toBeFocused();
    await expect(firstTaskCheckbox).toHaveCSS("outline-width", "2px");
    await expect(firstTaskCheckbox).toHaveCSS(
      "outline-color",
      surface.colors.brandFocus,
    );
    await expect(mention).not.toBeFocused();

    const documentHref = await akbLink.getAttribute("href");
    if (!documentHref) throw new Error("Resolved AKB document link has no URL");
    const documentPopup = page.waitForEvent("popup");
    await akbLink.focus();
    await page.keyboard.press("Enter");
    const openedDocument = await documentPopup;
    await expect.poll(() => openedDocument.url()).toBe(documentHref);
    await openedDocument.close();

    await expect(fileLink).toHaveAttribute(
      "data-markdown-resolution",
      "available",
    );
    await expect(fileLink).toHaveAttribute("href", /^\/api\/files\?/u);
    const fileRequest = page.context().waitForEvent("request", (request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/files" &&
        url.searchParams.get("uri") === MARKDOWN_FIXTURE_FILE_URI
      );
    });
    await fileLink.click();
    expect((await fileRequest).method()).toBe("GET");
  });
});
