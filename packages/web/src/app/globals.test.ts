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
    expect(css).toContain("--reef-list-focus-left: 0px");
    expect(css).toContain("--reef-list-focus-width: 100%");
    expect(css).toContain(".reef-issue-list-row:focus-visible");
    expect(css).toContain('.reef-issue-list-row[data-keyboard-focused="true"]');
    expect(css).toContain(
      ".reef-issue-list-row:focus-visible > td:first-child::after",
    );
    expect(css).toContain("left: calc(var(--reef-list-focus-left) + 1px)");
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
      "--tw-prose-links": "--brand",
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
  });
});
