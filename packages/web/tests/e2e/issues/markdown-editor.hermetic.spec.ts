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
        images: root.querySelectorAll("img").length,
        fileLinks: root.querySelectorAll('a[data-reef-file-link="true"]')
          .length,
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
        brand: resolveColor("--brand"),
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
        brand: resolveColor("--brand"),
        borderSubtle: resolveColor("--border-subtle"),
        surfaceSubtle: resolveBackground("--surface-subtle"),
      },
      typography: {
        fontSize: rootStyles.fontSize,
        lineHeight: rootStyles.lineHeight,
      },
      overflow: {
        comment: root.scrollWidth <= root.clientWidth,
        codeBlock: codeBlockBody
          ? codeBlockBody.scrollWidth > codeBlockBody.clientWidth
          : false,
        codeBlockContained: codeBlockBody
          ? codeBlockBody.scrollWidth > codeBlockBody.clientWidth &&
            root.scrollWidth <= root.clientWidth
          : false,
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
    await expect(brokenImage).toHaveAttribute("alt", "Broken fixture image");
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
      display: "block",
      marginBlockStart: "16px",
      marginBlockEnd: "16px",
    });

    const fileLink = editor.getByRole("link", { name: "incident.log" });
    await expect(fileLink).toHaveAttribute("data-reef-file-link", "true");
    await expect(fileLink.locator("[data-reef-file-type]")).toHaveAttribute(
      "data-reef-file-type",
      "LOG",
    );
    await expect(fileLink).toHaveAttribute(
      "data-reef-file-uri",
      MARKDOWN_FIXTURE_FILE_URI,
    );
    await expect(fileLink).toHaveAttribute("target", "_blank");
    await expect(fileLink).toHaveAttribute("rel", "noreferrer");
    await expect(fileLink).toHaveAttribute("data-reference-kind", "file");
    const fileProxyHref = await fileLink.getAttribute("href");
    if (!fileProxyHref)
      throw new Error("Markdown fixture file link has no href");
    expect(fileProxyHref).not.toContain(MARKDOWN_FIXTURE_FILE_URI);
    expect(fileProxyHref).toContain(
      "/api/issues/REEF-001/attachments/file?vault=reef-e2e&uri=",
    );
    expect(fileProxyHref).toContain("download=1");
    const fileResponse = await page.request.get(
      new URL(fileProxyHref, page.url()).toString(),
    );
    expect(fileResponse.status()).toBe(200);
    expect(fileResponse.headers()["content-type"]).toContain("text/plain");
    expect(fileResponse.headers()["content-disposition"]).toContain(
      "attachment",
    );
    expect(await fileResponse.text()).toContain("fixture incident log");

    const issueReference = editor.getByRole("link", {
      name: "REEF-002 Alpha follow-up",
    });
    await expect(issueReference).toHaveAttribute(
      "data-reference-kind",
      "issue",
    );
    await expect(issueReference).toHaveAttribute("data-issue-id", "REEF-002");
    await expect(issueReference).toHaveAttribute(
      "data-issue-status",
      "in_progress",
    );
    await expect(issueReference.locator("[data-reference-id]")).toHaveText(
      "REEF-002",
    );
    await expect(issueReference.locator("[data-reference-title]")).toHaveText(
      "Alpha follow-up",
    );
    await expect(issueReference).toHaveAttribute(
      "href",
      "/workspace/reef-e2e/issues/REEF-002",
    );
    const documentReference = editor.locator(
      'a[data-reference-kind="document"]',
    );
    await expect(documentReference).toHaveAttribute(
      "data-document-uri",
      "akb://reef-e2e/coll/docs/doc/spec-overview.md",
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
        mentions: 1,
        tables: 1,
      });
      expect(surface.colors.body).toBe(surface.colors.foreground);
      expect(surface.colors.heading).toBe(surface.colors.foreground);
      expect(surface.colors.link).toBe(surface.colors.brand);
      expect(surface.colors.mention).toBe(surface.colors.brand);
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
          accentColor: surface.colors.brand,
          bodyColor: surface.colors.mutedForeground,
          bodyDecoration: "line-through",
        }),
        expect.objectContaining({
          checked: "false",
          checkboxWidth: "16px",
          checkboxHeight: "16px",
          accentColor: surface.colors.brand,
          bodyColor: surface.colors.foreground,
          bodyDecoration: "none",
        }),
        expect.objectContaining({
          checked: "true",
          checkboxWidth: "16px",
          checkboxHeight: "16px",
          accentColor: surface.colors.brand,
          bodyColor: surface.colors.mutedForeground,
          bodyDecoration: "line-through",
        }),
      ]);
      for (const taskItem of surface.taskItemMetrics) {
        expect(taskItem.firstRowCenterDelta).toBeLessThanOrEqual(4);
      }
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
      const source = page.getByTestId("markdown-source-textarea");
      await expect(source).toBeVisible();
      const sourceMarkdown = await source.inputValue();
      expect(sourceMarkdown).toContain("# Markdown reference");
      expect(sourceMarkdown).toContain("한국어 문서와 English notes");
      expect(sourceMarkdown).toContain("## Structure");
      expect(sourceMarkdown).toContain("### Details");
      expect(sourceMarkdown).toContain("@alice");
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
        mentions: 1,
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
    const saveSource = page.getByTestId("markdown-source-textarea");
    const persistedMarker = "\n\nreef-517 save round-trip marker";
    const sourceBeforeSave = await saveSource.inputValue();
    await saveSource.fill(`${sourceBeforeSave}${persistedMarker}`);
    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/issues/REEF-001") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    );
    await page.getByTestId("issue-title-input").click();
    await saveResponse;

    await page.reload();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    const reopenedEditor = page.locator(".reef-markdown-editor");
    await expect(reopenedEditor).toBeVisible();
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const reopenedSource = page.getByTestId("markdown-source-textarea");
    const reopenedMarkdown = await reopenedSource.inputValue();
    expect(reopenedMarkdown).toContain(persistedMarker.trim());
    expect(reopenedMarkdown).toContain(MARKDOWN_FIXTURE_LARGE_IMAGE_PATH);
    expect(reopenedMarkdown).toContain(MARKDOWN_FIXTURE_TRANSPARENT_IMAGE_PATH);
    expect(reopenedMarkdown).toContain(MARKDOWN_FIXTURE_FILE_URI);
    expect(reopenedMarkdown).toContain("REEF-002");
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    await expect(reopenedEditor.locator("img")).toHaveCount(4);
    const reopenedFileLink = reopenedEditor.getByRole("link", {
      name: "incident.log",
    });
    await expect(reopenedFileLink).toHaveAttribute(
      "data-reef-file-link",
      "true",
    );
    await expect(reopenedFileLink).toHaveAttribute("target", "_blank");
    await expect(
      reopenedEditor.locator('a[data-reference-kind="issue"]'),
    ).toHaveAttribute("data-issue-id", "REEF-002");
    expect(await reopenedFileLink.getAttribute("href")).toContain(
      "/api/issues/REEF-001/attachments/file?",
    );

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
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
    const source = page.getByTestId("markdown-source-textarea");
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

    const menu = page.getByTestId("slash-command-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option")).toHaveCount(10);
    await expect(menu.locator("[data-slash-section]")).toHaveCount(3);
    await expect(menu.locator("input")).toHaveCount(0);
    await expect(page.locator('[data-slash-command*="reef" i]')).toHaveCount(0);
    await expect(editor).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.type("table");
    await expect(menu.getByRole("option")).toHaveCount(1);
    await expect(menu.locator('[data-slash-command="table"]')).toBeVisible();
    await menu.locator('[data-slash-command="table"]').click();
    await expect(menu).toHaveCount(0);

    await expect(editor.locator("table")).toHaveCount(1);
    await expect(editor.locator("table tr")).toHaveCount(3);
    await expect(editor.locator("table th")).toHaveCount(2);
    await expect(editor.locator("table td")).toHaveCount(4);

    const sourceToggle = page
      .getByTestId("markdown-source-toggle")
      .getByRole("button");
    await sourceToggle.click();
    const source = page.getByTestId("markdown-source-textarea");
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

    await page.reload();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    const reopenedEditor = page.locator(".reef-markdown-editor");
    await expect(reopenedEditor).toBeVisible();
    await expect(reopenedEditor.locator("table")).toHaveCount(1);
    await expect(reopenedEditor.locator("table tr")).toHaveCount(3);
    await expect(reopenedEditor.locator("table th")).toHaveCount(2);
    await expect(reopenedEditor.locator("table td")).toHaveCount(4);
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
    const editor = dialog.locator(".reef-markdown-editor");
    await expect(
      editor.locator("p.is-empty:only-child[data-placeholder]"),
    ).toHaveAttribute(
      "data-placeholder",
      "Describe the issue or type / to insert a block…",
    );

    const sourceToggle = dialog
      .getByTestId("markdown-source-toggle")
      .getByRole("button");
    await sourceToggle.click();
    const source = dialog.getByTestId("markdown-source-textarea");
    await expect(source).toHaveValue("");
    await expect(source).toHaveAttribute("placeholder", "Describe the issue…");
    await sourceToggle.click();

    await editor.click();
    await page.keyboard.type("Body authored in the editor");
    await expect(
      editor.locator("p.is-empty:only-child[data-placeholder]"),
    ).toHaveCount(0);

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
    const menu = page.getByTestId("slash-command-menu");
    await expect(menu).toBeVisible();

    const options = menu.getByRole("option");
    const optionsViewport = menu.locator(".reef-slash-command-options");
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

    const table = menu.locator('[data-slash-command="table"]');
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

    const menu = page.getByTestId("slash-command-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option")).toHaveCount(10);

    const initialGeometry = await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>(
        '[data-testid="slash-command-menu"]',
      );
      const options = menu?.querySelector<HTMLElement>(
        ".reef-slash-command-options",
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

    const options = menu.locator(".reef-slash-command-options");
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
            ".reef-slash-command-options",
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
    const narrowGeometry = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(narrowGeometry.left).toBeGreaterThanOrEqual(8);
    expect(narrowGeometry.right).toBeLessThanOrEqual(
      narrowGeometry.viewportWidth - 8,
    );
    expect(narrowGeometry.documentWidth).toBeLessThanOrEqual(
      narrowGeometry.viewportWidth,
    );

    await dialog.getByTestId("new-issue-cancel").click();
  });

  test("uses one categorized @ menu for people, issues, and documents", async ({
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
    await expect(
      listbox.locator('[data-reference-section="people"]'),
    ).toBeVisible();
    await expect(
      listbox.locator('[data-reference-section="issues"]'),
    ).toBeVisible();
    await expect(
      listbox.locator('[data-reference-section="documents"]'),
    ).toBeVisible();

    await expect(
      listbox.getByRole("option").filter({ hasText: "alice" }),
    ).toBeVisible();
    await expect(
      listbox.getByRole("option").filter({ hasText: "REEF-002" }),
    ).toBeVisible();
    await expect(
      listbox.getByRole("option").filter({ hasText: "Alpha reference" }),
    ).toBeVisible();

    await listbox
      .getByRole("option")
      .filter({ hasText: "Alpha reference" })
      .click();
    await expect(editor).toHaveAttribute("aria-expanded", "false");
    await expect(editor).toBeFocused();
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const source = page.getByTestId("markdown-source-textarea");
    await expect(source).toHaveValue(
      /\[Alpha reference\]\(akb:\/\/reef-e2e\/coll\/docs\/doc\/alpha-reference\.md\) /u,
    );
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();

    const state = await readFixtureState(request);
    const calls = state.calls ?? [];
    expect(
      calls.some(
        (call) =>
          call.method === "POST" && call.path.includes("/api/v1/relations"),
      ),
    ).toBe(false);
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
    const bodyBeforeEscape = await editor.textContent();

    await page.keyboard.press("Escape");

    await expect(listbox).toHaveCount(0);
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveAttribute("aria-expanded", "false");
    await expect(editor).toHaveText(bodyBeforeEscape ?? "");
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
    const inlineCode = editor
      .locator("p code")
      .filter({ hasText: "inline code" });
    await expect(inlineCode).toBeVisible();
    await inlineCode.click();
    await page.keyboard.type("@inline");
    await expect(
      editor.locator("code").filter({ hasText: "@inline" }),
    ).toBeVisible();
    await expect(page.getByRole("listbox")).toHaveCount(0);

    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("`@inline");
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

  test("keeps independent task state through keyboard, Source, save, and re-entry", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 720, height: 900 });
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

    await parent.focus();
    await page.keyboard.press("Space");
    await expect(parent).not.toBeChecked();
    await expect(checkboxes.nth(1)).not.toBeChecked();
    await expect(checkboxes.nth(2)).toBeChecked();

    const sourceToggle = page
      .getByTestId("markdown-source-toggle")
      .getByRole("button");
    await sourceToggle.click();
    const source = page.getByTestId("markdown-source-textarea");
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
    await expect(page.getByTestId("markdown-source-textarea")).toHaveValue(
      /- \[ \] Completed parent/u,
    );
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
    const surface = await readMarkdownSurface(editor);
    const normalLink = editor.getByRole("link", { name: "reef link" });
    const akbLink = editor.getByRole("link", { name: "AKB report" });
    const issueReference = editor.getByRole("link", {
      name: "REEF-002 Alpha follow-up",
    });
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
    await expect(issueReference).toBeFocused();
    await expect(issueReference).toHaveCSS("border-top-width", "1px");

    await page.keyboard.press("Tab");
    await expect(firstTaskCheckbox).toBeFocused();
    await expect(firstTaskCheckbox).toHaveCSS("outline-width", "2px");
    await expect(firstTaskCheckbox).toHaveCSS(
      "outline-color",
      surface.colors.brand,
    );
    await expect(mention).not.toBeFocused();
  });
});
