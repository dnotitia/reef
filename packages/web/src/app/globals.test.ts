// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readGlobalCss(): string {
  const entryPath = fileURLToPath(new URL("./globals.css", import.meta.url));
  const visiting = new Set<string>();

  function expand(filePath: string): string {
    if (visiting.has(filePath)) {
      throw new Error(`Circular CSS import: ${filePath}`);
    }
    visiting.add(filePath);
    const css = readFileSync(filePath, "utf8");
    const expanded = css.replace(
      /@import\s+["']([^"']+)["']\s*;?/g,
      (statement, source: string) => {
        if (!source.startsWith(".")) {
          return statement;
        }
        return `${statement}\n${expand(resolve(dirname(filePath), source))}`;
      },
    );
    visiting.delete(filePath);
    return expanded;
  }

  return expand(entryPath);
}

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

const STATUS_IDENTITIES = [
  "backlog",
  "open",
  "in-progress",
  "in-review",
  "done",
  "closed",
] as const;

const ROLE_SUFFIXES = ["text", "fill", "glyph", "focus", "chart"] as const;

function tokenRgb(css: string, selector: string, token: string): Rgb {
  return readHslToken(css, selector, token);
}

describe("global focus styles", () => {
  it("keeps the canonical teal focus-visible outline in the base layer", () => {
    const css = readGlobalCss();
    const focusRuleStart = css.indexOf("*:focus-visible");
    expect(focusRuleStart).toBeGreaterThan(-1);

    const baseLayerStart = css.lastIndexOf("@layer base", focusRuleStart);
    expect(baseLayerStart).toBeGreaterThan(-1);
    expect(focusRuleStart).toBeLessThan(findCssBlockEnd(css, baseLayerStart));
    const focusRuleEnd = findCssBlockEnd(css, focusRuleStart);
    const focusRule = css.slice(focusRuleStart, focusRuleEnd);
    expect(focusRule).toContain("outline: 2px solid var(--brand-focus);");
    expect(focusRule).toContain("outline-offset: 2px;");
  });

  it("keeps issue list row focus as one scrollport-scoped rounded border above dividers", () => {
    const css = readGlobalCss();

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
    expect(css).toContain(
      '.reef-issue-list-row[aria-selected="true"]:focus-visible',
    );
    expect(css).toContain(
      '.reef-issue-list-row[aria-selected="true"][data-keyboard-focused="true"]',
    );
    expect(css).toContain('.reef-issue-list-row[aria-selected="true"] > td');
    expect(css).toContain("left: 1px");
    expect(css).toContain("width: calc(var(--reef-list-focus-width) - 2px)");
    expect(css).toContain("border: 2px solid var(--reef-issue-list-row-ring)");
    expect(css).toContain("border-block-color: transparent");
    expect(css).toContain(
      ".reef-issue-list-row:has(+ .reef-issue-list-row:focus-visible) > td",
    );
    expect(css).toContain("border-bottom-color: transparent");
    expect(css).toContain(
      '.reef-issue-list-row[data-keyboard-focused="true"]:not(:has(:focus))',
    );
    expect(css).toContain(
      '.reef-issue-list-row[aria-selected="true"] > td:first-child::after {\n  content: none;',
    );
    expect(css).toContain(
      ".reef-issue-backlog-row:focus-visible {\n  outline: 2px solid var(--brand-focus);",
    );
    expect(css).toContain(
      ".reef-selection-checkbox:has(> input:focus-visible) {\n  outline: 2px solid var(--brand-focus);",
    );
    expect(css).toContain("outline-offset: -2px;");
  });

  it("compresses the default List sticky columns through narrow viewports", () => {
    const css = readGlobalCss();

    expect(css).toContain("@media (max-width: 480px)");
    expect(css).toContain("@media (min-width: 768px) and (max-width: 1311px)");
    expect(css).toContain(
      ".reef-issue-list-table {\n    min-width: 0 !important;",
    );
    expect(css).toContain(
      '[data-testid="issue-list-scroll-container"] {\n  container-type: inline-size;\n}',
    );
    expect(css).toContain(
      ".reef-issue-list-group-header {\n  width: min(100%, 100cqi);\n}",
    );
    expect(css).toContain('.reef-issue-list-table [data-column-key="title"]');
    expect(css).toContain("min-width: 144px !important");
    expect(css).toContain(
      "width: clamp(76px, calc(100vw - 244px), 144px) !important",
    );
  });

  it("styles comment mentions from the sanitized renderer marker", () => {
    const css = readGlobalCss();
    expect(css).toContain(".comment-mention-renderer [data-reef-mention]");
    expect(css).toContain("color: var(--brand-text);");
    expect(css).toContain("font-weight: 500;");
  });

  it("makes only tooltip-owned Radix Popper wrappers hit-test transparent", () => {
    const css = readGlobalCss();
    expect(css).toContain(
      '[data-radix-popper-content-wrapper]:has([data-reef-tooltip-content="true"])',
    );
    expect(css).toContain("pointer-events: none;");
  });

  it("keeps the Settings link's foreground text and focus outline accessible", () => {
    const css = readGlobalCss();
    const lightBackground = readHslToken(css, ":root {", "--surface-page");
    const lightForeground = readHslToken(css, ":root {", "--foreground");
    const darkBackground = readHslToken(css, ":root.dark", "--surface-page");
    const darkForeground = readHslToken(css, ":root.dark", "--foreground");

    expect(
      contrastRatio(lightForeground, lightBackground),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(darkForeground, darkBackground),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps role-specific focus tokens visible across light/dark surfaces", () => {
    const css = readGlobalCss();
    expect(css).toContain("--brand-focus: hsl(173 80% 25%);");
    expect(css).toContain("--brand-focus: hsl(173 70% 78%);");
    expect(css).toContain("--brand-on-fill: hsl(0 0% 100%);");

    for (const selector of [":root {", ":root.dark"]) {
      const foreground = readHslToken(css, selector, "--foreground");
      const background = readHslToken(css, selector, "--surface-page");
      const subtleSurface = readHslToken(css, selector, "--surface-subtle");

      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(foreground, subtleSurface)).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it("keeps page/subtle/card/elevated/popover surfaces distinct and role contrast AA-safe", () => {
    const css = readGlobalCss();
    const surfaces = [
      "--surface-page",
      "--surface-subtle",
      "--surface-elevated",
      "--surface-card",
      "--surface-popover",
    ] as const;
    const identities = ["brand", "destructive", ...STATUS_IDENTITIES] as const;

    for (const selector of [":root {", ":root.dark"]) {
      const surfaceColors = surfaces.map((token) =>
        tokenRgb(css, selector, token),
      );
      expect(new Set(surfaceColors.map((color) => color.join(","))).size).toBe(
        surfaces.length,
      );

      for (const identity of identities) {
        const prefix =
          identity === "brand" || identity === "destructive"
            ? `--${identity}`
            : `--status-${identity}`;
        const colorPrefix =
          identity === "brand" || identity === "destructive"
            ? identity
            : `status-${identity}`;
        for (const role of ROLE_SUFFIXES) {
          expect(css).toContain(`${prefix}-${role}:`);
          expect(css).toContain(
            `--color-${colorPrefix}-${role}: var(${prefix}-${role});`,
          );
        }

        const text = tokenRgb(css, selector, `${prefix}-text`);
        const glyph = tokenRgb(css, selector, `${prefix}-glyph`);
        const focus = tokenRgb(css, selector, `${prefix}-focus`);
        const chart = tokenRgb(css, selector, `${prefix}-chart`);
        const fill = tokenRgb(css, selector, `${prefix}-fill`);

        for (const surface of surfaceColors) {
          expect(
            contrastRatio(text, surface),
            `${selector} ${identity} text`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            contrastRatio(glyph, surface),
            `${selector} ${identity} glyph`,
          ).toBeGreaterThanOrEqual(3);
          expect(
            contrastRatio(focus, surface),
            `${selector} ${identity} focus`,
          ).toBeGreaterThanOrEqual(3);
          expect(
            contrastRatio(chart, surface),
            `${selector} ${identity} chart`,
          ).toBeGreaterThanOrEqual(3);
          expect(
            contrastRatio(fill, surface),
            `${selector} ${identity} fill`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("maps every surface role directly into its semantic Tailwind utility", () => {
    const css = readGlobalCss();
    const surfaceRoles = [
      "page",
      "subtle",
      "card",
      "elevated",
      "popover",
    ] as const;

    for (const role of surfaceRoles) {
      expect(css).toContain(`--color-surface-${role}: var(--surface-${role});`);
    }
  });

  it("keeps the planning family distinct while meeting non-text contrast", () => {
    const css = readGlobalCss();
    const planningTokens = [
      "--planning-pending",
      "--planning-open",
      "--planning-active",
      "--planning-closed",
      "--planning-released",
    ] as const;
    const surfaces = [
      "--surface-page",
      "--surface-subtle",
      "--surface-elevated",
      "--surface-card",
      "--surface-popover",
    ] as const;

    for (const selector of [":root {", ":root.dark"]) {
      for (const token of planningTokens) {
        const planningColor = tokenRgb(css, selector, token);
        expect(css).toContain(`--color-${token.slice(2)}: var(${token});`);
        for (const surface of surfaces) {
          expect(
            contrastRatio(planningColor, tokenRgb(css, selector, surface)),
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("does not reintroduce removed neutral aliases or collapse semantic roles", () => {
    const css = readGlobalCss();
    for (const obsolete of [
      "--background:",
      "--card:",
      "--card-foreground:",
      "--popover:",
      "--popover-foreground:",
      "--brand:",
      "--brand-foreground:",
      "--destructive:",
      "--destructive-foreground:",
      "--ring:",
      "--status-open:",
    ]) {
      expect(css).not.toContain(obsolete);
    }

    for (const identity of ["brand", "destructive", ...STATUS_IDENTITIES]) {
      const prefix =
        identity === "brand" || identity === "destructive"
          ? identity
          : `status-${identity}`;
      const roleValues = ROLE_SUFFIXES.map(
        (role) =>
          css.match(new RegExp(`--${prefix}-${role}: hsl\\([^;]+\\);`))?.[0],
      );
      expect(new Set(roleValues).size).toBe(ROLE_SUFFIXES.length);
    }
  });

  it("keeps the Inter + Noto Sans KR display/body fallback contract", () => {
    const css = readGlobalCss();
    expect(css).toContain(
      "--font-display:\n    var(--font-inter), var(--font-noto-sans-kr), ui-sans-serif, system-ui,\n    sans-serif;",
    );
    expect(css).toContain(
      "--font-body:\n    var(--font-inter), var(--font-noto-sans-kr), ui-sans-serif, system-ui,\n    sans-serif;",
    );
    expect(css).toContain(
      "var(--font-geist-mono), var(--font-noto-sans-kr), ui-monospace,",
    );
    expect(css).toContain("--font-sans: var(--font-body);");
  });

  it("loads the three root variable font roles through next/font", () => {
    const layout = readFileSync(
      new URL("./layout.tsx", import.meta.url),
      "utf8",
    );
    expect(layout).toContain(
      'import { Geist_Mono, Inter, Noto_Sans_KR } from "next/font/google";',
    );
    expect(layout).toContain('variable: "--font-inter"');
    expect(layout).toContain('variable: "--font-noto-sans-kr"');
    expect(layout).toContain('variable: "--font-geist-mono"');
    expect(layout).toContain('display: "swap"');
    expect(layout).toContain("${notoSansKr.variable}");
  });

  it("defines one complete named contract for routed product typography", () => {
    const css = readGlobalCss();
    const roles = {
      "type-page-title": [
        "font-size: var(--type-page-title-size);",
        "font-weight: var(--type-page-title-weight);",
        "line-height: var(--type-page-title-line-height);",
        "letter-spacing: var(--type-page-title-tracking);",
      ],
      "type-group-title": [
        "font-size: var(--type-group-title-size);",
        "font-weight: var(--type-group-title-weight);",
        "line-height: var(--type-group-title-line-height);",
        "letter-spacing: var(--type-group-title-tracking);",
      ],
      "type-section-label": [
        "font-size: var(--type-section-label-size);",
        "font-weight: var(--type-section-label-weight);",
        "line-height: var(--type-section-label-line-height);",
        "letter-spacing: var(--type-section-label-tracking);",
        "text-transform: uppercase;",
      ],
      "type-navigation": [
        "font-size: var(--type-navigation-size);",
        "font-weight: var(--type-navigation-weight);",
        "line-height: var(--type-navigation-line-height);",
        "letter-spacing: var(--type-navigation-tracking);",
      ],
      "type-control": [
        "font-size: var(--type-control-size);",
        "font-weight: var(--type-control-weight);",
        "line-height: var(--type-control-line-height);",
        "letter-spacing: var(--type-control-tracking);",
      ],
      "type-board-status": [
        "font-size: var(--type-board-status-size);",
        "font-weight: var(--type-board-status-weight);",
        "line-height: var(--type-board-status-line-height);",
        "letter-spacing: var(--type-board-status-tracking);",
        "text-transform: uppercase;",
      ],
      "type-board-epic": [
        "font-size: var(--type-board-epic-size);",
        "font-weight: var(--type-board-epic-weight);",
        "line-height: var(--type-board-epic-line-height);",
        "letter-spacing: var(--type-board-epic-tracking);",
        "text-transform: none;",
      ],
      "type-card-title": [
        "font-size: var(--type-card-title-size);",
        "font-weight: var(--type-card-title-weight);",
        "line-height: var(--type-card-title-line-height);",
        "letter-spacing: var(--type-card-title-tracking);",
      ],
      "type-card-metadata": [
        "font-size: var(--type-card-metadata-size);",
        "font-weight: var(--type-card-metadata-weight);",
        "line-height: var(--type-card-metadata-line-height);",
        "letter-spacing: var(--type-card-metadata-tracking);",
      ],
      "type-card-context": [
        "font-size: var(--type-card-context-size);",
        "font-weight: var(--type-card-context-weight);",
        "line-height: var(--type-card-context-line-height);",
        "letter-spacing: var(--type-card-context-tracking);",
      ],
      "type-compact-mono": [
        "font-family: var(--font-mono-stack);",
        "font-size: var(--type-compact-mono-size);",
        "font-weight: var(--type-compact-mono-weight);",
        "line-height: var(--type-compact-mono-line-height);",
        "letter-spacing: var(--type-compact-mono-tracking);",
        "font-variant-numeric: tabular-nums;",
      ],
      "type-detail-section": [
        "font-size: var(--type-detail-section-size);",
        "font-weight: var(--type-detail-section-weight);",
        "line-height: var(--type-detail-section-line-height);",
        "letter-spacing: var(--type-detail-section-tracking);",
        "text-transform: uppercase;",
      ],
      "type-comment": [
        "font-size: var(--type-comment-size);",
        "font-weight: var(--type-comment-weight);",
        "line-height: var(--type-comment-line-height);",
        "letter-spacing: var(--type-comment-tracking);",
      ],
      "type-report-section": [
        "font-size: var(--type-report-section-size);",
        "font-weight: var(--type-report-section-weight);",
        "line-height: var(--type-report-section-line-height);",
        "letter-spacing: var(--type-report-section-tracking);",
        "text-transform: uppercase;",
      ],
      "type-table-header": [
        "font-size: var(--type-table-header-size);",
        "font-weight: var(--type-table-header-weight);",
        "line-height: var(--type-table-header-line-height);",
        "letter-spacing: var(--type-table-header-tracking);",
        "text-transform: uppercase;",
      ],
      "type-chart-metadata": [
        "font-size: var(--type-chart-metadata-size);",
        "font-weight: var(--type-chart-metadata-weight);",
        "line-height: var(--type-chart-metadata-line-height);",
        "letter-spacing: var(--type-chart-metadata-tracking);",
      ],
      "type-chart-tick": [
        "font-size: var(--type-chart-tick-size);",
        "font-weight: var(--type-chart-tick-weight);",
        "line-height: var(--type-chart-tick-line-height);",
        "letter-spacing: var(--type-chart-tick-tracking);",
      ],
      "type-body": [
        "font-size: var(--type-body-size);",
        "font-weight: var(--type-body-weight);",
        "line-height: var(--type-body-line-height);",
      ],
      "type-caption": [
        "font-size: var(--type-caption-size);",
        "font-weight: var(--type-caption-weight);",
        "line-height: var(--type-caption-line-height);",
      ],
      "type-mono-value": [
        "font-family: var(--font-mono-stack);",
        "font-size: var(--type-mono-value-size);",
        "font-variant-numeric: tabular-nums;",
      ],
      "type-chart-label": [
        "font-size: var(--type-chart-label-size);",
        "font-weight: var(--type-chart-label-weight);",
        "line-height: var(--type-chart-label-line-height);",
      ],
      "type-list-group": [
        "font-size: var(--type-list-group-size);",
        "font-weight: var(--type-list-group-weight);",
        "line-height: var(--type-list-group-line-height);",
        "letter-spacing: var(--type-list-group-tracking);",
        "text-transform: none;",
      ],
      "type-list-group-count": [
        "font-family: var(--font-mono-stack);",
        "font-size: var(--type-list-group-count-size);",
        "font-weight: var(--type-list-group-count-weight);",
        "line-height: var(--type-list-group-count-line-height);",
        "letter-spacing: var(--type-list-group-count-tracking);",
        "font-variant-numeric: tabular-nums;",
      ],
      "type-board-type": [
        "font-size: var(--type-board-type-size);",
        "font-weight: var(--type-board-type-weight);",
        "line-height: var(--type-board-type-line-height);",
        "letter-spacing: var(--type-board-type-tracking);",
        "text-transform: none;",
      ],
      "type-detail-type": [
        "font-size: var(--type-detail-type-size);",
        "font-weight: var(--type-detail-type-weight);",
        "line-height: var(--type-detail-type-line-height);",
        "letter-spacing: var(--type-detail-type-tracking);",
        "text-transform: none;",
      ],
      "type-board-blocked": [
        "font-size: var(--type-board-blocked-size);",
        "font-weight: var(--type-board-blocked-weight);",
        "line-height: var(--type-board-blocked-line-height);",
        "letter-spacing: var(--type-board-blocked-tracking);",
        "text-transform: uppercase;",
      ],
      "type-list-id": [
        "font-family: var(--font-mono-stack);",
        "font-size: var(--type-list-id-size);",
        "font-weight: var(--type-list-id-weight);",
        "line-height: var(--type-list-id-line-height);",
        "letter-spacing: var(--type-list-id-tracking);",
        "font-variant-numeric: tabular-nums;",
      ],
      "type-timeline-group": [
        "font-size: var(--type-timeline-group-size);",
        "font-weight: var(--type-timeline-group-weight);",
        "line-height: var(--type-timeline-group-line-height);",
        "letter-spacing: var(--type-timeline-group-tracking);",
        "text-transform: none;",
      ],
      "type-timeline-title": [
        "font-size: var(--type-timeline-title-size);",
        "font-weight: var(--type-timeline-title-weight);",
        "line-height: var(--type-timeline-title-line-height);",
        "letter-spacing: var(--type-timeline-title-tracking);",
        "text-transform: none;",
      ],
      "type-timeline-month": [
        "font-size: var(--type-timeline-month-size);",
        "font-weight: var(--type-timeline-month-weight);",
        "line-height: var(--type-timeline-month-line-height);",
        "letter-spacing: var(--type-timeline-month-tracking);",
        "text-transform: none;",
      ],
      "type-timeline-tick": [
        "font-size: var(--type-timeline-tick-size);",
        "font-weight: var(--type-timeline-tick-weight);",
        "line-height: var(--type-timeline-tick-line-height);",
        "letter-spacing: var(--type-timeline-tick-tracking);",
        "text-transform: none;",
      ],
      "type-timeline-assignee": [
        "font-size: var(--type-timeline-assignee-size);",
        "font-weight: var(--type-timeline-assignee-weight);",
        "line-height: var(--type-timeline-assignee-line-height);",
        "letter-spacing: var(--type-timeline-assignee-tracking);",
        "text-transform: none;",
      ],
      "type-report-row-label": [
        "font-size: var(--type-report-row-label-size);",
        "font-weight: var(--type-report-row-label-weight);",
        "line-height: var(--type-report-row-label-line-height);",
        "letter-spacing: var(--type-report-row-label-tracking);",
        "text-transform: none;",
      ],
      "type-report-cell": [
        "font-family: var(--font-mono-stack);",
        "font-size: var(--type-report-cell-size);",
        "font-weight: var(--type-report-cell-weight);",
        "line-height: var(--type-report-cell-line-height);",
        "letter-spacing: var(--type-report-cell-tracking);",
        "font-variant-numeric: tabular-nums;",
      ],
      "type-report-header": [
        "font-size: var(--type-report-header-size);",
        "font-weight: var(--type-report-header-weight);",
        "line-height: var(--type-report-header-line-height);",
        "letter-spacing: var(--type-report-header-tracking);",
        "text-transform: uppercase;",
      ],
      "type-throughput-tick": [
        "font-size: var(--type-throughput-tick-size);",
        "font-weight: var(--type-throughput-tick-weight);",
        "line-height: var(--type-throughput-tick-line-height);",
        "letter-spacing: var(--type-throughput-tick-tracking);",
        "text-transform: none;",
      ],
      "type-snapshot-label": [
        "font-size: var(--type-snapshot-label-size);",
        "font-weight: var(--type-snapshot-label-weight);",
        "line-height: var(--type-snapshot-label-line-height);",
        "letter-spacing: var(--type-snapshot-label-tracking);",
        "text-transform: uppercase;",
      ],
      "type-settings-description": [
        "font-size: var(--type-settings-description-size);",
        "font-weight: var(--type-settings-description-weight);",
        "line-height: var(--type-settings-description-line-height);",
        "letter-spacing: var(--type-settings-description-tracking);",
        "text-transform: none;",
      ],
      "type-settings-section": [
        "font-size: var(--type-settings-section-size);",
        "font-weight: var(--type-settings-section-weight);",
        "line-height: var(--type-settings-section-line-height);",
        "letter-spacing: var(--type-settings-section-tracking);",
        "text-transform: uppercase;",
      ],
      "type-settings-group": [
        "font-size: var(--type-settings-group-size);",
        "font-weight: var(--type-settings-group-weight);",
        "line-height: var(--type-settings-group-line-height);",
        "letter-spacing: var(--type-settings-group-tracking);",
        "text-transform: none;",
      ],
      "type-theme-description": [
        "font-size: var(--type-theme-description-size);",
        "font-weight: var(--type-theme-description-weight);",
        "line-height: var(--type-theme-description-line-height);",
        "letter-spacing: var(--type-theme-description-tracking);",
        "text-transform: none;",
      ],
      "type-segmented-control": [
        "font-size: var(--type-segmented-control-size);",
        "font-weight: var(--type-segmented-control-weight);",
        "line-height: var(--type-segmented-control-line-height);",
        "letter-spacing: var(--type-segmented-control-tracking);",
        "text-transform: none;",
      ],
      "type-small-button": [
        "font-size: var(--type-small-button-size);",
        "font-weight: var(--type-small-button-weight);",
        "line-height: var(--type-small-button-line-height);",
        "letter-spacing: var(--type-small-button-tracking);",
        "text-transform: none;",
      ],
      "type-subissue-progress": [
        "font-size: var(--type-subissue-progress-size);",
        "font-weight: var(--type-subissue-progress-weight);",
        "line-height: var(--type-subissue-progress-line-height);",
        "letter-spacing: var(--type-subissue-progress-tracking);",
        "text-transform: none;",
      ],
      "type-dialog-title": [
        "font-size: var(--type-dialog-title-size);",
        "font-weight: var(--type-dialog-title-weight);",
        "line-height: var(--type-dialog-title-line-height);",
        "letter-spacing: var(--type-dialog-title-tracking);",
        "text-transform: none;",
      ],
    } as const;

    for (const [role, declarations] of Object.entries(roles)) {
      const start = css.indexOf(`.${role} {`);
      expect(start, role).toBeGreaterThan(-1);
      const end = findCssBlockEnd(css, start);
      expect(end, role).toBeGreaterThan(start);
      const block = css.slice(start, end);
      for (const declaration of declarations) {
        expect(block, `${role}: ${declaration}`).toContain(declaration);
      }
    }
    expect(css).toContain("--type-page-title-size: 14px;");
    expect(css).toContain("--type-group-title-size: 15px;");
    expect(css).toContain("--type-section-label-size: 13px;");
    expect(css).toContain("--type-caption-size: 12px;");
    expect(css).toContain("--type-navigation-size: 13px;");
    expect(css).toContain("--type-control-size: 13px;");
    expect(css).toContain("--type-board-status-size: 12px;");
    expect(css).toContain("--type-card-title-size: 13px;");
    expect(css).toContain("--type-card-metadata-size: 11px;");
    expect(css).toContain("--type-compact-mono-size: 11px;");
    expect(css).toContain("--type-detail-section-size: 11px;");
    expect(css).toContain("--type-table-header-weight: 500;");
    expect(css).toContain("--type-table-header-line-height: 15px;");
    expect(css).toContain("--type-table-header-tracking: 0.05em;");
    expect(css).toContain("--type-list-group-size: 12px;");
    expect(css).toContain("--type-board-type-size: 10px;");
    expect(css).toContain("--type-detail-type-line-height: 14.6667px;");
    expect(css).toContain("--type-board-blocked-tracking: 0.25px;");
    expect(css).toContain("--type-list-id-size: 12px;");
    expect(css).toContain("--type-timeline-title-size: 12px;");
    expect(css).toContain("--type-timeline-month-size: 11px;");
    expect(css).toContain("--type-timeline-tick-line-height: 15px;");
    expect(css).toContain("--type-report-row-label-size: 12px;");
    expect(css).toContain("--type-report-cell-size: 12px;");
    expect(css).toContain("--type-report-header-tracking: 0.25px;");
    expect(css).toContain("--type-throughput-tick-size: 11px;");
    expect(css).toContain("--type-snapshot-label-tracking: 0.275px;");
    expect(css).toContain("--type-settings-group-line-height: 22.5px;");
    expect(css).toContain("--type-theme-description-size: 11px;");
    expect(css).toContain("--type-segmented-control-size: 12px;");
    expect(css).toContain("--type-small-button-size: 12px;");
    expect(css).toContain("--type-subissue-progress-size: 12px;");
    expect(css).toContain("--type-dialog-title-size: 16px;");
    for (const source of [
      "../features/ui/components/PageHeader.tsx",
      "../features/ui/components/DashboardShell.tsx",
      "../features/ai/components/AskAiDialog.tsx",
      "../components/ui/dialog.tsx",
      "../components/ui/sheet.tsx",
    ]) {
      expect(
        readFileSync(new URL(source, import.meta.url), "utf8"),
        `${source} inline tracking`,
      ).not.toContain("letterSpacing");
    }
  });

  it("renders the Tiptap empty-editor placeholder marker", () => {
    const css = readGlobalCss();

    expect(css).toContain(
      ".reef-markdown-editor > .is-empty:only-child[data-placeholder]::before",
    );
    expect(css).toContain("content: attr(data-placeholder);");
    expect(css).toContain("pointer-events: none;");
  });

  it("keeps every editor Typography color variable on Reef semantic tokens", () => {
    const css = readGlobalCss();
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
      "--tw-prose-quote-borders": "--brand-focus",
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
    expect(linkBlock).toContain("color: var(--brand-text);");
    expect(linkBlock).toContain("text-decoration-line: underline;");
    expect(linkBlock).toContain("text-decoration-color: var(--brand-text);");
    expect(linkBlock).toContain("text-decoration-thickness: 1px;");
    expect(linkBlock).toContain("text-underline-offset: 2px;");
    expect(css).toContain(".reef-markdown-editor a:visited");

    const interactiveLinkStart = css.indexOf(".reef-markdown-editor a:hover,");
    expect(interactiveLinkStart).toBeGreaterThan(linkEnd);
    const interactiveLinkEnd = findCssBlockEnd(css, interactiveLinkStart);
    expect(interactiveLinkEnd).toBeGreaterThan(interactiveLinkStart);
    expect(css.slice(interactiveLinkStart, interactiveLinkEnd)).toContain(
      "text-decoration-color: var(--brand-text);",
    );
    expect(css.slice(interactiveLinkStart, interactiveLinkEnd)).toContain(
      "text-decoration-thickness: 2px;",
    );
    expect(css).toContain(".reef-markdown-editor a:focus-visible");
  });

  it("defines one semantic token contract for the comment Streamdown scope", () => {
    const css = readGlobalCss();
    const surfaceStart = css.indexOf(".reef-markdown-surface {");
    expect(surfaceStart).toBeGreaterThan(-1);
    const surfaceEnd = findCssBlockEnd(css, surfaceStart);
    expect(surfaceEnd).toBeGreaterThan(surfaceStart);
    const surfaceBlock = css.slice(surfaceStart, surfaceEnd);

    for (const token of [
      "--foreground",
      "--muted-foreground",
      "--brand-focus",
      "--surface-subtle",
      "--border-subtle",
    ]) {
      expect(surfaceBlock).toContain(`var(${token})`);
    }

    expect(css).toContain(".reef-markdown-comment");
    expect(css).toContain(
      '.reef-markdown-comment [data-streamdown="code-block-body"]',
    );
    expect(css).toContain(
      '.reef-markdown-comment [data-streamdown="table-wrapper"]',
    );
    expect(css).toContain('.reef-markdown-comment [data-streamdown="image"]');
    expect(css).toContain(
      '.reef-markdown-comment button[data-streamdown="link"]:focus-visible',
    );
  });

  it("gives inline marks an explicit Reef hierarchy without touching code blocks", () => {
    const css = readGlobalCss();

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
    const css = readGlobalCss();
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
    expect(mentionBlock).toContain("color: var(--brand-text);");
    expect(mentionBlock).toContain("font-weight: 500;");
    expect(mentionBlock).toContain("text-decoration-line: none;");
  });

  it("keeps issue Markdown rhythm compact and scoped to direct blocks", () => {
    const css = readGlobalCss();
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
    const css = readGlobalCss();
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
    const css = readGlobalCss();
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
    const css = readGlobalCss();
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
    const css = readGlobalCss();

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
    expect(checkboxBlock).toContain("accent-color: var(--brand-glyph);");

    const focusStart = css.indexOf(
      '.reef-markdown-editor\n  ul[data-type="taskList"]\n  > li\n  > label\n  input[type="checkbox"]:focus-visible {',
    );
    expect(focusStart).toBeGreaterThan(-1);
    const focusEnd = findCssBlockEnd(css, focusStart);
    const focusBlock = css.slice(focusStart, focusEnd);
    expect(focusBlock).toContain("outline: 2px solid var(--brand-focus);");
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
    const css = readGlobalCss();

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
      "border-inline-start: 2px solid var(--brand-focus);",
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
