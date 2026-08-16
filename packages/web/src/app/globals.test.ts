// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function findCssBlockEnd(css: string, blockStart: number): number {
  const openBrace = css.indexOf("{", blockStart);
  if (openBrace === -1) {
    return -1;
  }

  let depth = 0;
  for (let index = openBrace; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

type Rgb = [number, number, number];

function readHslToken(css: string, selector: string, token: string): Rgb {
  const selectorStart = css.indexOf(selector);
  expect(selectorStart).toBeGreaterThan(-1);
  const blockEnd = findCssBlockEnd(css, selectorStart);
  expect(blockEnd).toBeGreaterThan(selectorStart);
  const block = css.slice(selectorStart, blockEnd);
  const match = block.match(
    new RegExp(`${token}: hsl\\((\\d+) (\\d+)% (\\d+)%\\)`),
  );
  if (!match) throw new Error(`Missing ${token} in ${selector}`);

  const hue = Number(match[1]);
  const saturation = Number(match[2]) / 100;
  const lightness = Number(match[3]) / 100;
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return 255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };

  return [channel(0), channel(8), channel(4)];
}

function relativeLuminance(rgb: Rgb): number {
  const linear = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: Rgb, second: Rgb): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("global focus styles", () => {
  it("keeps the fallback focus-visible outline in the base layer", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const focusRuleStart = css.indexOf("*:focus-visible");
    expect(focusRuleStart).toBeGreaterThan(-1);

    const baseLayerStart = css.lastIndexOf("@layer base", focusRuleStart);
    expect(baseLayerStart).toBeGreaterThan(-1);
    expect(focusRuleStart).toBeLessThan(findCssBlockEnd(css, baseLayerStart));
  });

  it("keeps issue list row focus as one scrollport-scoped rounded border above dividers", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

    expect(css).toContain("border-radius: 0.375rem");
    expect(css).toContain("--reef-list-focus-width: 100%");
    expect(css).toContain(".reef-issue-list-row:focus-visible");
    expect(css).toContain('.reef-issue-list-row[data-keyboard-focused="true"]');
    expect(css).toContain(
      ".reef-issue-list-row:focus-visible > td:first-child::after",
    );
    expect(css).toContain(
      '.reef-issue-list-row[aria-selected="true"] > td:first-child::after',
    );
    expect(css).toContain('.reef-issue-list-row[aria-selected="true"] > td');
    expect(css).toContain("left: 1px");
    expect(css).toContain("width: calc(var(--reef-list-focus-width) - 2px)");
    expect(css).toContain("border: 1px solid var(--reef-issue-list-row-ring)");
    expect(css).toContain("border-block-color: transparent");
    expect(css).toContain(
      ".reef-issue-list-row:has(+ .reef-issue-list-row:focus-visible) > td",
    );
    expect(css).toContain("border-bottom-color: transparent");
  });

  it("styles comment mentions from the sanitized renderer marker", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    expect(css).toContain(".comment-mention-renderer [data-reef-mention]");
    expect(css).toContain("color: var(--brand);");
    expect(css).toContain("font-weight: 500;");
  });

  it("keeps the Settings link's foreground text and focus outline accessible", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const lightBackground = readHslToken(css, ":root {", "--background");
    const lightForeground = readHslToken(css, ":root {", "--foreground");
    const darkBackground = readHslToken(css, ":root.dark", "--background");
    const darkForeground = readHslToken(css, ":root.dark", "--foreground");

    expect(
      contrastRatio(lightForeground, lightBackground),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(darkForeground, darkBackground),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the shared focus token visible across light/dark surfaces without changing brand declarations", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    expect(css).toContain("--brand: hsl(173 80% 40%);");
    expect(css).toContain("--brand: hsl(173 70% 45%);");
    expect(css).toContain("--brand-foreground: hsl(0 0% 100%);");

    for (const selector of [":root {", ":root.dark"]) {
      const foreground = readHslToken(css, selector, "--foreground");
      const background = readHslToken(css, selector, "--background");
      const subtleSurface = readHslToken(css, selector, "--surface-subtle");

      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(foreground, subtleSurface)).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it("renders the Tiptap empty-editor placeholder marker", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

    expect(css).toContain(
      ".reef-markdown-editor > .is-empty:only-child[data-placeholder]::before",
    );
    expect(css).toContain("content: attr(data-placeholder);");
    expect(css).toContain("pointer-events: none;");
  });

  it("keeps every editor Typography color variable on Reef semantic tokens", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const editorStart = css.indexOf(".reef-markdown-editor {");
    expect(editorStart).toBeGreaterThan(-1);
    const editorEnd = findCssBlockEnd(css, editorStart);
    expect(editorEnd).toBeGreaterThan(editorStart);
    const editorBlock = css.slice(editorStart, editorEnd);
    const expectedTokens = {
      "--tw-prose-body": "--foreground",
      "--tw-prose-headings": "--foreground",
      "--tw-prose-lead": "--muted-foreground",
      "--tw-prose-links": "--foreground",
      "--tw-prose-bold": "--foreground",
      "--tw-prose-counters": "--muted-foreground",
      "--tw-prose-bullets": "--muted-foreground",
      "--tw-prose-hr": "--border-subtle",
      "--tw-prose-quotes": "--foreground",
      "--tw-prose-quote-borders": "--brand",
      "--tw-prose-captions": "--muted-foreground",
      "--tw-prose-kbd": "--foreground",
      "--tw-prose-kbd-shadows": "--border-subtle",
      "--tw-prose-code": "--foreground",
      "--tw-prose-pre-code": "--foreground",
      "--tw-prose-pre-bg": "--surface-subtle",
      "--tw-prose-th-borders": "--border-subtle",
      "--tw-prose-td-borders": "--border-subtle",
    } as const;

    for (const [variable, token] of Object.entries(expectedTokens)) {
      expect(editorBlock).toContain(`${variable}: var(${token});`);
    }

    const linkStart = css.indexOf(".reef-markdown-editor a,");
    expect(linkStart).toBeGreaterThan(-1);
    const linkEnd = findCssBlockEnd(css, linkStart);
    expect(linkEnd).toBeGreaterThan(linkStart);
    const linkBlock = css.slice(linkStart, linkEnd);
    expect(linkBlock).toContain("color: var(--brand);");
    expect(linkBlock).toContain("text-decoration-line: underline;");
    expect(linkBlock).toContain("text-decoration-color: var(--brand);");
    expect(linkBlock).toContain("text-decoration-thickness: 1px;");
    expect(linkBlock).toContain("text-underline-offset: 2px;");
    expect(css).toContain(".reef-markdown-editor a:visited");

    const interactiveLinkStart = css.indexOf(".reef-markdown-editor a:hover,");
    expect(interactiveLinkStart).toBeGreaterThan(linkEnd);
    const interactiveLinkEnd = findCssBlockEnd(css, interactiveLinkStart);
    expect(interactiveLinkEnd).toBeGreaterThan(interactiveLinkStart);
    expect(css.slice(interactiveLinkStart, interactiveLinkEnd)).toContain(
      "text-decoration-color: var(--brand);",
    );
    expect(css.slice(interactiveLinkStart, interactiveLinkEnd)).toContain(
      "text-decoration-thickness: 2px;",
    );
    expect(css).toContain(".reef-markdown-editor a:focus-visible");
  });

  it("gives inline marks an explicit Reef hierarchy without touching code blocks", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

    const inlineCodeStart = css.indexOf(
      ".reef-markdown-editor :not(pre) > code {",
    );
    expect(inlineCodeStart).toBeGreaterThan(-1);
    const inlineCodeEnd = findCssBlockEnd(css, inlineCodeStart);
    expect(inlineCodeEnd).toBeGreaterThan(inlineCodeStart);
    const inlineCodeBlock = css.slice(inlineCodeStart, inlineCodeEnd);
    for (const declaration of [
      "font-family: var(--font-mono-stack);",
      "color: var(--foreground);",
      "background-color: var(--surface-subtle);",
      "border: 1px solid var(--border-subtle);",
      "border-radius: 0.25rem;",
      "padding-inline: 0.25rem;",
      "padding-block: 0.125rem;",
      "vertical-align: baseline;",
    ]) {
      expect(inlineCodeBlock, declaration).toContain(declaration);
    }

    expect(css).toContain(".reef-markdown-editor :not(pre) > code::before,");
    expect(css).toContain(".reef-markdown-editor :not(pre) > code::after");
    expect(css).toContain("content: none;");
    expect(css).not.toContain(".reef-markdown-editor code {");
    expect(css).not.toContain(".reef-markdown-editor pre code {");
  });

  it("keeps bold, italic, strike, and mentions on the foreground hierarchy", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    for (const [selector, declarations] of [
      [
        ".reef-markdown-editor strong {",
        ["color: var(--foreground);", "font-weight: 600;"],
      ],
      [
        ".reef-markdown-editor em {",
        ["color: var(--foreground);", "font-style: italic;"],
      ],
      [
        ".reef-markdown-editor s,",
        ["color: var(--foreground);", "text-decoration-line: line-through;"],
      ],
    ] as const) {
      const start = css.indexOf(selector);
      expect(start, selector).toBeGreaterThan(-1);
      const end = findCssBlockEnd(css, start);
      expect(end, selector).toBeGreaterThan(start);
      const block = css.slice(start, end);
      for (const declaration of declarations) {
        expect(block, `${selector} ${declaration}`).toContain(declaration);
      }
    }

    const mentionStart = css.indexOf(
      ".reef-markdown-editor [data-reef-mention] {",
    );
    expect(mentionStart).toBeGreaterThan(-1);
    const mentionEnd = findCssBlockEnd(css, mentionStart);
    expect(mentionEnd).toBeGreaterThan(mentionStart);
    const mentionBlock = css.slice(mentionStart, mentionEnd);
    expect(mentionBlock).toContain("color: var(--brand);");
    expect(mentionBlock).toContain("font-weight: 500;");
    expect(mentionBlock).toContain("text-decoration-line: none;");
  });

  it("keeps issue Markdown rhythm compact and scoped to direct blocks", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const directBlockRules = [
      [
        ".reef-markdown-editor > p",
        ["font-size: 14px;", "line-height: 22px;", "margin-block: 8px;"],
      ],
      [
        ".reef-markdown-editor > h1",
        [
          "font-size: 24px;",
          "line-height: 30px;",
          "font-weight: 600;",
          "margin-block: 24px 10px;",
        ],
      ],
      [
        ".reef-markdown-editor > h2",
        [
          "font-size: 20px;",
          "line-height: 28px;",
          "font-weight: 600;",
          "margin-block: 22px 8px;",
        ],
      ],
      [
        ".reef-markdown-editor > h3",
        [
          "font-size: 16px;",
          "line-height: 24px;",
          "font-weight: 600;",
          "margin-block: 20px 6px;",
        ],
      ],
    ] as const;

    for (const [selector, declarations] of directBlockRules) {
      const selectorStart = css.indexOf(`${selector} {`);
      expect(selectorStart, selector).toBeGreaterThan(-1);
      const selectorEnd = findCssBlockEnd(css, selectorStart);
      expect(selectorEnd, selector).toBeGreaterThan(selectorStart);
      const block = css.slice(selectorStart, selectorEnd);
      for (const declaration of declarations) {
        expect(block, `${selector} ${declaration}`).toContain(declaration);
      }
    }

    expect(css).toContain(
      ".reef-markdown-editor > :first-child {\n  margin-block-start: 0;",
    );
    expect(css).toContain(
      ".reef-markdown-editor > :last-child {\n  margin-block-end: 0;",
    );
    expect(css).not.toContain(".reef-markdown-editor p {");
    expect(css).toContain(
      '.reef-markdown-editor ul[data-type="taskList"] > li > div > p {',
    );
  });

  it("contains editor images without enlarging small evidence or leaking globally", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const imageStart = css.indexOf(".reef-markdown-editor > img {");
    expect(imageStart).toBeGreaterThan(-1);
    const imageEnd = findCssBlockEnd(css, imageStart);
    const imageBlock = css.slice(imageStart, imageEnd);

    for (const declaration of [
      "display: block;",
      "width: auto;",
      "height: auto;",
      "max-width: 100%;",
      "max-height: 32rem;",
      "object-fit: contain;",
      "margin-block: 16px;",
      "background: var(--surface-subtle);",
      "border: 1px solid var(--border-subtle);",
      "border-radius: 0.375rem;",
      "color: var(--muted-foreground);",
      "overflow-wrap: anywhere;",
    ]) {
      expect(imageBlock, declaration).toContain(declaration);
    }

    expect(css).not.toContain("\nimg {");
  });

  it("keeps file-link surface and long-label wrapping scoped to the editor", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const fileLinkStart = css.indexOf(
      '.reef-markdown-editor a[data-reef-file-link="true"] {',
    );
    expect(fileLinkStart).toBeGreaterThan(-1);
    const fileLinkEnd = findCssBlockEnd(css, fileLinkStart);
    const fileLinkBlock = css.slice(fileLinkStart, fileLinkEnd);
    for (const declaration of [
      "display: inline-flex;",
      "align-items: baseline;",
      "max-width: 100%;",
      "min-width: 0;",
      "overflow-wrap: anywhere;",
      "word-break: break-word;",
      "white-space: normal;",
      "background: var(--surface-subtle);",
      "border: 1px solid var(--border-subtle);",
      "border-radius: 0.25rem;",
      "text-decoration: none;",
    ]) {
      expect(fileLinkBlock, declaration).toContain(declaration);
    }

    const typeBadgeStart = css.indexOf(
      '.reef-markdown-editor\n  a[data-reef-file-link="true"]\n  > [data-reef-file-type]::after {',
    );
    expect(typeBadgeStart).toBeGreaterThan(fileLinkEnd);
    const typeBadgeEnd = findCssBlockEnd(css, typeBadgeStart);
    expect(css.slice(typeBadgeStart, typeBadgeEnd)).toContain(
      "content: attr(data-reef-file-type);",
    );
    expect(css).not.toContain('\na[data-reef-file-link="true"] {');
  });

  it("gives issue, document, and file references one compact semantic surface", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const surfaceStart = css.indexOf(
      ".reef-markdown-editor [data-reference-kind] {",
    );
    expect(surfaceStart).toBeGreaterThan(-1);
    const surfaceEnd = findCssBlockEnd(css, surfaceStart);
    expect(surfaceEnd).toBeGreaterThan(surfaceStart);
    const surfaceBlock = css.slice(surfaceStart, surfaceEnd);
    for (const declaration of [
      "display: inline-flex;",
      "align-items: baseline;",
      "border: 1px solid var(--border-subtle);",
      "background: var(--surface-subtle);",
      "vertical-align: baseline;",
      "text-decoration: none;",
    ]) {
      expect(surfaceBlock, declaration).toContain(declaration);
    }
    expect(css).toContain(
      '.reef-markdown-editor [data-reference-kind="issue"]',
    );
    expect(css).toContain("font-family: var(--font-mono-stack);");
    expect(css).toContain(
      '.reef-markdown-editor a[data-reference-kind="document"]::before',
    );
    const documentGlyphStart = css.indexOf(
      '.reef-markdown-editor a[data-reference-kind="document"]::before',
    );
    const documentGlyphEnd = findCssBlockEnd(css, documentGlyphStart);
    const fileGlyphStart = css.indexOf(
      '.reef-markdown-editor a[data-reef-file-link="true"]::before',
    );
    const fileGlyphEnd = findCssBlockEnd(css, fileGlyphStart);
    expect(documentGlyphStart).toBeGreaterThan(-1);
    expect(fileGlyphStart).toBeGreaterThan(documentGlyphEnd);
    expect(css.slice(documentGlyphStart, documentGlyphEnd)).toContain(
      'content: "▤";',
    );
    expect(css.slice(fileGlyphStart, fileGlyphEnd)).toContain('content: "▱";');
    expect(css.slice(documentGlyphStart, documentGlyphEnd)).toContain(
      "align-self: center;",
    );
    expect(css.slice(fileGlyphStart, fileGlyphEnd)).toContain(
      "align-self: center;",
    );
    expect(css.slice(documentGlyphStart, documentGlyphEnd)).not.toContain(
      'content: "▱";',
    );
    expect(css.slice(fileGlyphStart, fileGlyphEnd)).not.toContain(
      'content: "▤";',
    );
    expect(css).toContain(".reef-markdown-editor [data-reference-glyph],");
    expect(css).not.toContain("\n[data-reference-kind] {");
  });

  it("keeps normal lists dense while preserving the live task-list contract", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

    const normalListStart = css.indexOf(
      '.reef-markdown-editor ol:not([data-type="taskList"]),',
    );
    expect(normalListStart).toBeGreaterThan(-1);
    const normalListEnd = findCssBlockEnd(css, normalListStart);
    expect(normalListEnd).toBeGreaterThan(normalListStart);
    expect(css.slice(normalListStart, normalListEnd)).toContain(
      "padding-inline-start: 1.25rem;",
    );

    for (const selector of [
      '.reef-markdown-editor ol:not([data-type="taskList"]) > li > p',
      '.reef-markdown-editor ul:not([data-type="taskList"]) > li > p',
    ]) {
      const start = css.indexOf(selector);
      expect(start, selector).toBeGreaterThan(-1);
      const end = findCssBlockEnd(css, start);
      expect(css.slice(start, end)).toContain("margin-block: 0;");
    }

    const itemGapStart = css.indexOf(
      '.reef-markdown-editor ol:not([data-type="taskList"]) > li + li,',
    );
    expect(itemGapStart).toBeGreaterThan(-1);
    const itemGapEnd = findCssBlockEnd(css, itemGapStart);
    expect(css.slice(itemGapStart, itemGapEnd)).toContain(
      "margin-block-start: 4px;",
    );

    const markerStart = css.indexOf(
      '.reef-markdown-editor ol:not([data-type="taskList"]) > li::marker,',
    );
    expect(markerStart).toBeGreaterThan(-1);
    const markerEnd = findCssBlockEnd(css, markerStart);
    expect(css.slice(markerStart, markerEnd)).toContain(
      "color: var(--muted-foreground);",
    );

    const checkboxStart = css.indexOf(
      '.reef-markdown-editor\n  ul[data-type="taskList"]\n  > li\n  > label\n  input[type="checkbox"] {',
    );
    expect(checkboxStart).toBeGreaterThan(-1);
    const checkboxEnd = findCssBlockEnd(css, checkboxStart);
    const checkboxBlock = css.slice(checkboxStart, checkboxEnd);
    expect(checkboxBlock).toContain("width: 1rem;");
    expect(checkboxBlock).toContain("height: 1rem;");
    expect(checkboxBlock).toContain("accent-color: var(--brand);");

    const focusStart = css.indexOf(
      '.reef-markdown-editor\n  ul[data-type="taskList"]\n  > li\n  > label\n  input[type="checkbox"]:focus-visible {',
    );
    expect(focusStart).toBeGreaterThan(-1);
    const focusEnd = findCssBlockEnd(css, focusStart);
    const focusBlock = css.slice(focusStart, focusEnd);
    expect(focusBlock).toContain("outline: 2px solid var(--brand);");
    expect(focusBlock).toContain("outline-offset: 2px;");

    const checkedStart = css.indexOf(
      '.reef-markdown-editor\n  ul[data-type="taskList"]\n  > li[data-checked="true"]',
    );
    expect(checkedStart).toBeGreaterThan(-1);
    const checkedEnd = findCssBlockEnd(css, checkedStart);
    const checkedBlock = css.slice(checkedStart, checkedEnd);
    expect(checkedBlock).toContain("color: var(--muted-foreground);");
    expect(checkedBlock).toContain("text-decoration-line: line-through;");
    expect(checkedBlock).toContain("text-decoration-thickness: 1px;");
  });

  it("keeps block Markdown surfaces dense, scoped, and scroll-contained", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

    const preStart = css.indexOf(".reef-markdown-editor > pre {");
    expect(preStart).toBeGreaterThan(-1);
    const preEnd = findCssBlockEnd(css, preStart);
    expect(preEnd).toBeGreaterThan(preStart);
    const preBlock = css.slice(preStart, preEnd);
    for (const declaration of [
      "font-family: var(--font-mono-stack);",
      "font-size: 13px;",
      "line-height: 20px;",
      "color: var(--foreground);",
      "background: var(--surface-subtle);",
      "border: 1px solid var(--border-subtle);",
      "border-radius: 0.375rem;",
      "padding: 12px 14px;",
      "max-width: 100%;",
      "min-width: 0;",
      "overflow-x: auto;",
      "white-space: pre;",
    ]) {
      expect(preBlock, declaration).toContain(declaration);
    }

    const quoteStart = css.indexOf(".reef-markdown-editor > blockquote {");
    expect(quoteStart).toBeGreaterThan(-1);
    const quoteEnd = findCssBlockEnd(css, quoteStart);
    expect(quoteEnd).toBeGreaterThan(quoteStart);
    const quoteBlock = css.slice(quoteStart, quoteEnd);
    for (const declaration of [
      "border-inline-start: 2px solid var(--brand);",
      "background: var(--surface-subtle);",
      "font-style: normal;",
      "quotes: none;",
      "padding: 8px 12px;",
    ]) {
      expect(quoteBlock, declaration).toContain(declaration);
    }

    const quotePseudoStart = css.indexOf(
      ".reef-markdown-editor > blockquote::before,",
    );
    expect(quotePseudoStart).toBeGreaterThan(quoteEnd);
    const quotePseudoEnd = findCssBlockEnd(css, quotePseudoStart);
    expect(quotePseudoEnd).toBeGreaterThan(quotePseudoStart);
    expect(css.slice(quotePseudoStart, quotePseudoEnd)).toContain(
      "content: none;",
    );
    expect(css).toContain(
      ".reef-markdown-editor > blockquote > p:first-of-type::before,",
    );
    expect(css).toContain(
      ".reef-markdown-editor > blockquote > p:last-of-type::after",
    );
    expect(css).toContain(
      ".reef-markdown-editor > blockquote > :first-child {\n  margin-block-start: 0;",
    );
    expect(css).toContain(
      ".reef-markdown-editor > blockquote > :last-child {\n  margin-block-end: 0;",
    );

    const ruleStart = css.indexOf(".reef-markdown-editor > hr {");
    expect(ruleStart).toBeGreaterThan(-1);
    const ruleEnd = findCssBlockEnd(css, ruleStart);
    expect(ruleEnd).toBeGreaterThan(ruleStart);
    const ruleBlock = css.slice(ruleStart, ruleEnd);
    for (const declaration of [
      "border: 0;",
      "border-top: 1px solid var(--border-subtle);",
      "height: 0;",
      "margin-block: 24px;",
    ]) {
      expect(ruleBlock, declaration).toContain(declaration);
    }

    const globalHrStart = css.indexOf("hr {");
    expect(globalHrStart).toBeGreaterThan(-1);
    const globalHrEnd = findCssBlockEnd(css, globalHrStart);
    expect(globalHrEnd).toBeGreaterThan(globalHrStart);
    expect(css.slice(globalHrStart, globalHrEnd)).toContain(
      "border-color: var(--border-subtle);",
    );
    expect(css.slice(globalHrStart, globalHrEnd)).not.toContain(
      "margin-block: 24px;",
    );
  });
});
