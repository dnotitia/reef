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

describe("global focus styles", () => {
  it("keeps the fallback focus-visible outline in the base layer", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const focusRuleStart = css.indexOf("*:focus-visible");
    expect(focusRuleStart).toBeGreaterThan(-1);

    const baseLayerStart = css.lastIndexOf("@layer base", focusRuleStart);
    expect(baseLayerStart).toBeGreaterThan(-1);
    expect(focusRuleStart).toBeLessThan(findCssBlockEnd(css, baseLayerStart));
  });
});
