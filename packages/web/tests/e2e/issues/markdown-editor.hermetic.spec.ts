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

async function setBrowserZoom(page: Page, scale: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setPageScaleFactor", {
    pageScaleFactor: scale,
  });
  await expect
    .poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1))
    .toBe(scale);
}

async function readSemanticReferenceGeometry(editor: Locator) {
  return editor.evaluate((root: HTMLElement) => {
    const readRect = (rect: DOMRect | DOMRectReadOnly) => {
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        centerY: rect.top + rect.height / 2,
      };
    };
    const readBox = (element: Element | null) =>
      element ? readRect(element.getBoundingClientRect()) : null;
    const readRangeBox = (element: Element | null) => {
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      return readRect(range.getBoundingClientRect());
    };
    const readSurface = (selector: string) => {
      const element = root.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const styles = getComputedStyle(element);
      const box = readBox(element);
      if (!box) return null;
      const border = Object.fromEntries(
        (["top", "right", "bottom", "left"] as const).map((side) => [
          side,
          {
            width: styles.getPropertyValue(`border-${side}-width`),
            style: styles.getPropertyValue(`border-${side}-style`),
            color: styles.getPropertyValue(`border-${side}-color`),
          },
        ]),
      );
      return {
        box,
        border,
        borderRadius: styles.borderTopLeftRadius,
        outline: {
          width: styles.outlineWidth,
          style: styles.outlineStyle,
          color: styles.outlineColor,
          offset: styles.outlineOffset,
        },
        parts: Array.from(element.children).map((part) => readBox(part)),
        label: readRangeBox(element),
        type: readRangeBox(element.querySelector("[data-reef-file-type]")),
        before: {
          content: getComputedStyle(element, "::before").content,
          lineHeight: getComputedStyle(element, "::before").lineHeight,
        },
        after: {
          content: getComputedStyle(element, "::after").content,
          lineHeight: getComputedStyle(element, "::after").lineHeight,
        },
      };
    };

    return {
      editor: {
        left: root.getBoundingClientRect().left,
        right: root.getBoundingClientRect().right,
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
      },
      document: readSurface('a[data-reef-document-link="true"]'),
      file: readSurface('a[data-reef-file-link="true"]'),
      issue: readSurface('[data-reef-issue-reference="true"]'),
      documentOverflow:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    };
  });
}

type SemanticSurfaceGeometry = NonNullable<
  Awaited<ReturnType<typeof readSemanticReferenceGeometry>>["document"]
>;

function assertSemanticSurfaceBorder(
  surface: SemanticSurfaceGeometry,
  borderColor: string,
): void {
  expect(surface.borderRadius).toBe("4px");
  for (const side of ["top", "right", "bottom", "left"] as const) {
    expect(surface.border[side]).toEqual({
      width: "1px",
      style: "solid",
      color: borderColor,
    });
  }
}

function assertOpticalCenter(surface: SemanticSurfaceGeometry): void {
  const partDeltas = surface.parts
    .filter((part): part is NonNullable<typeof part> => part !== null)
    .map((part) => Math.abs(part.centerY - surface.box.centerY));
  const labelDelta = surface.label
    ? Math.abs(surface.label.centerY - surface.box.centerY)
    : 0;
  expect(Math.max(...partDeltas, labelDelta)).toBeLessThanOrEqual(1);
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
    const documentLink = root.querySelector<HTMLElement>(
      'a[data-reef-document-link="true"]',
    );
    const fileLink = root.querySelector<HTMLElement>(
      'a[data-reef-file-link="true"]',
    );
    const issueReference = root.querySelector<HTMLElement>(
      '[data-reef-issue-reference="true"]',
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
        documentLinks: root.querySelectorAll(
          'a[data-reef-document-link="true"]',
        ).length,
        mentions: root.querySelectorAll('[data-reef-mention="true"]').length,
        issueReferences: root.querySelectorAll(
          '[data-reef-issue-reference="true"]',
        ).length,
        tables: root.querySelectorAll("table").length,
      },
      issueReference: issueReference
        ? {
            id: issueReference.getAttribute("data-reef-issue-id"),
            status: issueReference.getAttribute("data-reef-issue-status"),
            title: issueReference.getAttribute("data-reef-issue-title"),
            href: issueReference.getAttribute("data-reef-issue-href"),
            role: issueReference.getAttribute("role"),
            tabIndex: issueReference.getAttribute("tabindex"),
            label: issueReference.getAttribute("aria-label"),
            idText: issueReference.querySelector("[data-reef-issue-id-text]")
              ?.textContent,
            titleText: issueReference.querySelector(
              ":scope > [data-reef-issue-title]",
            )?.textContent,
            glyphStatus: issueReference
              .querySelector("[data-reef-status-glyph]")
              ?.getAttribute("data-reef-status"),
            insideLink: Boolean(issueReference.closest("a")),
          }
        : null,
      documentLink: documentLink
        ? {
            uri: documentLink.getAttribute("data-reef-document-uri"),
            glyph: documentLink.getAttribute("data-reef-document-glyph"),
            label: documentLink.textContent,
            display: getComputedStyle(documentLink).display,
            background: getComputedStyle(documentLink).backgroundColor,
            border: getComputedStyle(documentLink).borderTopColor,
            decoration: getComputedStyle(documentLink).textDecorationLine,
            glyphContent: getComputedStyle(documentLink, "::before").content,
          }
        : null,
      fileLink: fileLink
        ? {
            glyph: fileLink.getAttribute("data-reef-file-glyph"),
            glyphContent: getComputedStyle(fileLink, "::before").content,
            arrowContent: getComputedStyle(fileLink, "::after").content,
          }
        : null,
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
        border: resolveColor("--border"),
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
    context,
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
    expect(fixtureDocument?.content).toContain("Known REEF-001");
    expect(fixtureDocument?.content).toContain("unknown REEF-999");
    expect(fixtureDocument?.content).toContain(
      "[REEF-001](https://example.com/reef-001)",
    );
    expect(fixtureDocument?.content).toContain("`REEF-001`");
    expect(fixtureDocument?.content).toContain("\\REEF-001");
    expect(fixtureDocument?.content).toContain("```ts");
    expect(fixtureDocument?.content).toContain(
      `![Large fixture image](${MARKDOWN_FIXTURE_LARGE_IMAGE_PATH})`,
    );
    expect(fixtureDocument?.content).toContain(
      `[incident.log](${MARKDOWN_FIXTURE_FILE_URI})`,
    );

    await openExistingWorkspace(page);
    const issueResponse = await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await expect(editor).toBeVisible();
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
    await expect(fileLink).toHaveAttribute("data-reef-file-glyph", "true");
    await expect(fileLink.locator("[data-reef-file-type]")).toHaveAttribute(
      "data-reef-file-type",
      "LOG",
    );
    await expect
      .poll(() =>
        fileLink.evaluate(
          (element) => getComputedStyle(element, "::before").content,
        ),
      )
      .toBe('"▤"');
    await expect
      .poll(() =>
        fileLink.evaluate(
          (element) => getComputedStyle(element, "::after").content,
        ),
      )
      .toBe('"↗"');
    await expect(fileLink).toHaveAttribute(
      "data-reef-file-uri",
      MARKDOWN_FIXTURE_FILE_URI,
    );
    await expect(fileLink).toHaveAttribute("target", "_blank");
    await expect(fileLink).toHaveAttribute("rel", "noreferrer");
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

    const documentLink = editor.getByRole("link", { name: "AKB report" });
    await expect(documentLink).toHaveAttribute(
      "data-reef-document-link",
      "true",
    );
    await expect(documentLink).toHaveAttribute(
      "data-reef-document-glyph",
      "true",
    );
    await expect(documentLink).toHaveAttribute(
      "data-reef-document-uri",
      "akb://reef-e2e/coll/docs/doc/spec-overview.md",
    );
    await expect(documentLink).toHaveCSS("display", "inline-flex");
    await expect(documentLink).toHaveCSS("text-decoration-line", "none");
    await expect
      .poll(() =>
        documentLink.evaluate(
          (element) => getComputedStyle(element, "::before").content,
        ),
      )
      .toBe('"▣"');

    const issueReference = editor.locator('[data-reef-issue-reference="true"]');
    await expect(issueReference).toHaveCount(1);
    await expect(issueReference).toHaveAttribute(
      "data-reef-issue-id",
      "REEF-001",
    );
    await expect(issueReference).toHaveAttribute(
      "data-reef-issue-status",
      "todo",
    );
    await expect(issueReference).toHaveAttribute(
      "data-reef-issue-href",
      "/workspace/reef-e2e/issues/REEF-001",
    );
    await expect(issueReference).toHaveAttribute("role", "link");
    await expect(issueReference).toHaveAttribute("tabindex", "0");
    await expect(issueReference).toHaveAttribute(
      "aria-label",
      "Issue REEF-001: Markdown reference",
    );
    await expect(
      issueReference.locator("[data-reef-issue-id-text]"),
    ).toHaveText("REEF-001");
    await expect(
      issueReference.locator(":scope > [data-reef-issue-title]"),
    ).toHaveText("Markdown reference");
    await expect(
      issueReference.locator("[data-reef-status-glyph]"),
    ).toHaveAttribute("data-reef-status", "todo");
    await expect(
      editor.locator("a").filter({ hasText: "REEF-001" }),
    ).toHaveCount(1);
    await expect(
      editor.locator("code").filter({ hasText: "REEF-001" }),
    ).toHaveCount(1);

    await issueReference.focus();
    await expect(issueReference).toBeFocused();
    const pagesBeforeActivation = context.pages();
    await page.keyboard.press("Enter");
    await expect
      .poll(
        () =>
          context
            .pages()
            .filter((candidate) => !pagesBeforeActivation.includes(candidate))
            .length,
      )
      .toBe(1);
    const issuePopup = context
      .pages()
      .find((candidate) => !pagesBeforeActivation.includes(candidate));
    if (!issuePopup) {
      throw new Error("Issue reference activation opened no new page");
    }
    await issuePopup.waitForLoadState("domcontentloaded");
    expect(new URL(issuePopup.url()).pathname).toBe(
      "/workspace/reef-e2e/issues/REEF-001",
    );
    await issuePopup.close();

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
        documentLinks: 1,
        mentions: 1,
        issueReferences: 1,
        tables: 1,
      });
      expect(surface.issueReference).toMatchObject({
        id: "REEF-001",
        status: "todo",
        title: "Markdown reference",
        href: "/workspace/reef-e2e/issues/REEF-001",
        role: "link",
        tabIndex: "0",
        idText: "REEF-001",
        titleText: "Markdown reference",
        glyphStatus: "todo",
        insideLink: false,
      });
      expect(surface.documentLink).toMatchObject({
        uri: "akb://reef-e2e/coll/docs/doc/spec-overview.md",
        glyph: "true",
        label: "AKB report",
        display: "inline-flex",
        background: surface.colors.surfaceSubtle,
        border: surface.colors.border,
        decoration: "none",
        glyphContent: '"▣"',
      });
      expect(surface.fileLink).toMatchObject({
        glyph: "true",
        glyphContent: '"▤"',
        arrowContent: '"↗"',
      });
      expect(surface.colors.body).toBe(surface.colors.foreground);
      expect(surface.colors.heading).toBe(surface.colors.foreground);
      expect(surface.colors.link).toBe(surface.colors.brand);
      expect(surface.colors.mention).toBe(surface.colors.brand);
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
      expect(sourceMarkdown).toContain("Known REEF-001");
      expect(sourceMarkdown).toContain("unknown REEF-999");
      expect(sourceMarkdown).toContain(
        "[REEF-001](https://example.com/reef-001)",
      );
      expect(sourceMarkdown).toContain("`REEF-001`");
      expect(sourceMarkdown).toContain("\\REEF-001");
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
        documentLinks: 1,
        mentions: 1,
        issueReferences: 1,
        tables: 1,
      });
      expect(roundTrip.documentLink).toMatchObject({
        uri: "akb://reef-e2e/coll/docs/doc/spec-overview.md",
        glyph: "true",
        label: "AKB report",
      });
      expect(roundTrip.fileLink).toMatchObject({
        glyph: "true",
        glyphContent: '"▤"',
        arrowContent: '"↗"',
      });
      expect(roundTrip.text).toContain("@alice");
      expect(roundTrip.text).toContain("nested emphasis");
      expect(roundTrip.blockOrder).toEqual(surface.blockOrder);
    }

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
    expect(await reopenedFileLink.getAttribute("href")).toContain(
      "/api/issues/REEF-001/attachments/file?",
    );

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("contains the long code line at browser-level 200% zoom", async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 720, height: 900 });
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await expect(editor).toBeVisible();
    const semanticEntries = [
      { selector: '[data-reef-issue-reference="true"]', key: "issue" },
      { selector: 'a[data-reef-document-link="true"]', key: "document" },
      { selector: 'a[data-reef-file-link="true"]', key: "file" },
    ] as const;
    const initialSurface = await readMarkdownSurface(editor);
    const initialGeometry = await readSemanticReferenceGeometry(editor);
    const borderColor = initialSurface.colors.border;
    for (const entry of semanticEntries) {
      const reference = editor.locator(entry.selector);
      await expect(reference).toHaveCount(1);
      await reference.hover();
      const hovered = await readSemanticReferenceGeometry(editor);
      const hoveredSurface = hovered[entry.key];
      if (!hoveredSurface) throw new Error("Missing hovered surface");
      assertSemanticSurfaceBorder(hoveredSurface, borderColor);

      await reference.focus();
      const focused = await readSemanticReferenceGeometry(editor);
      const focusedSurface = focused[entry.key];
      if (!focusedSurface) throw new Error("Missing focused surface");
      assertSemanticSurfaceBorder(focusedSurface, borderColor);
      assertOpticalCenter(focusedSurface);
      expect(focusedSurface.outline).toMatchObject({
        width: "2px",
        style: "solid",
        offset: "2px",
      });
    }
    for (const semanticSurface of [
      initialGeometry.issue,
      initialGeometry.document,
      initialGeometry.file,
    ]) {
      if (!semanticSurface) throw new Error("Missing semantic surface");
      assertSemanticSurfaceBorder(semanticSurface, borderColor);
      assertOpticalCenter(semanticSurface);
    }

    const sourceToggle = page
      .getByTestId("markdown-source-toggle")
      .getByRole("button");
    await sourceToggle.click();
    const source = page.getByTestId("markdown-source-textarea");
    await expect(source).toBeVisible();
    const sourceMarkdown = await source.inputValue();
    expect(sourceMarkdown).toContain("```ts");
    expect(sourceMarkdown).toContain("intentionallyLongLine");
    expect(sourceMarkdown).toContain("Nested unordered item");
    expect(sourceMarkdown).toContain("Nested ordered child");
    expect(sourceMarkdown).toContain("---");
    await sourceToggle.click();
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

    await setBrowserZoom(page, 2);
    const zoomMetric = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      layoutWidth: document.documentElement.clientWidth,
      visualWidth: window.visualViewport?.width ?? 0,
    }));
    expect(zoomMetric.scale).toBe(2);
    expect(zoomMetric.visualWidth).toBeLessThan(zoomMetric.layoutWidth);
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

    const semanticGeometry = await readSemanticReferenceGeometry(editor);
    expect(surface.colors.border).toBe(borderColor);
    for (const semanticSurface of [
      semanticGeometry.issue,
      semanticGeometry.document,
      semanticGeometry.file,
    ]) {
      if (!semanticSurface) throw new Error("Missing semantic surface");
      assertSemanticSurfaceBorder(semanticSurface, borderColor);
      assertOpticalCenter(semanticSurface);
      expect(semanticSurface.box.left).toBeGreaterThanOrEqual(
        semanticGeometry.editor.left - 1,
      );
      expect(semanticSurface.box.right).toBeLessThanOrEqual(
        semanticGeometry.editor.right + 1,
      );
    }
    expect(semanticGeometry.editor.scrollWidth).toBeLessThanOrEqual(
      semanticGeometry.editor.clientWidth,
    );
    expect(semanticGeometry.documentOverflow).toBe(true);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: testInfo.outputPath("semantic-references-200-percent.png"),
    });
  });

  test("keeps semantic surfaces bordered and optically centered when wrapping", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 480, height: 720 });
    const task = await readMarkdownFixtureTask(request);
    await openExistingWorkspace(page);
    await page.goto(task.start_path ?? "");
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const editor = page.locator(".reef-markdown-editor");
    await expect(editor).toBeVisible();
    const sourceToggle = page
      .getByTestId("markdown-source-toggle")
      .getByRole("button");
    await sourceToggle.click();
    const source = page.getByTestId("markdown-source-textarea");
    const sourceMarkdown = await source.inputValue();
    const longDocumentLabel =
      "AKB document label that wraps inside the compact editor surface";
    const longFileLabel = "incident-log-long-filename-that-wraps.log";
    const wrappedMarkdown = sourceMarkdown
      .replace(
        "[AKB report]",
        `[${longDocumentLabel}](akb://reef-e2e/coll/docs/doc/spec-overview.md)`,
      )
      .replace(
        "[incident.log]",
        `[${longFileLabel}](${MARKDOWN_FIXTURE_FILE_URI})`,
      );
    expect(wrappedMarkdown).not.toBe(sourceMarkdown);
    await source.fill(wrappedMarkdown);
    await sourceToggle.click();
    await expect(editor).toBeVisible();

    const surface = await readMarkdownSurface(editor);
    const geometry = await readSemanticReferenceGeometry(editor);
    const borderColor = surface.colors.border;
    for (const semanticSurface of [
      geometry.issue,
      geometry.document,
      geometry.file,
    ]) {
      if (!semanticSurface) throw new Error("Missing semantic surface");
      assertSemanticSurfaceBorder(semanticSurface, borderColor);
      assertOpticalCenter(semanticSurface);
      expect(semanticSurface.box.left).toBeGreaterThanOrEqual(
        geometry.editor.left - 1,
      );
      expect(semanticSurface.box.right).toBeLessThanOrEqual(
        geometry.editor.right + 1,
      );
    }
    expect(geometry.document?.label?.height ?? 0).toBeGreaterThan(16);
    expect(geometry.file?.label?.height ?? 0).toBeGreaterThan(16);
    expect(geometry.editor.scrollWidth).toBeLessThanOrEqual(
      geometry.editor.clientWidth,
    );
    expect(geometry.documentOverflow).toBe(true);
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

  test("tabs through Markdown links and issue references while skipping the mention", async ({
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
    const linkedIssueId = editor.getByRole("link", {
      name: "REEF-001",
      exact: true,
    });
    const issueReference = editor.locator('[data-reef-issue-reference="true"]');
    const mention = editor.locator('[data-reef-mention="true"]');
    const firstTaskCheckbox = editor
      .locator('ul[data-type="taskList"] input[type="checkbox"]')
      .first();

    await expect(normalLink).toHaveAttribute("tabindex", "0");
    await expect(akbLink).toHaveAttribute("tabindex", "0");
    await expect(linkedIssueId).toHaveAttribute("tabindex", "0");
    await expect(issueReference).toHaveAttribute("tabindex", "0");
    await expect(mention).not.toHaveAttribute("tabindex");
    await expect(mention).not.toHaveRole("link");

    await editor.focus();
    await page.keyboard.press("Tab");
    await expect(normalLink).toBeFocused();
    await expect(normalLink).toHaveCSS("text-decoration-thickness", "2px");

    await page.keyboard.press("Tab");
    await expect(akbLink).toBeFocused();
    await expect(akbLink).toHaveCSS("outline-width", "2px");

    await page.keyboard.press("Tab");
    await expect(issueReference).toBeFocused();
    await expect(issueReference).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(linkedIssueId).toBeFocused();

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
