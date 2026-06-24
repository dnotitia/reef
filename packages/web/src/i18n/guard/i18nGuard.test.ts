// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanTree } from "./scanLiterals";

/**
 * The i18n hardcoded-string ratchet (REEF-293, extended in REEF-299).
 *
 * `scanLiterals` reports every user-facing English literal still living in JSX
 * or in a `toast(...)` message. This test pins that set to a committed baseline
 * and enforces a one-way ratchet:
 *
 *   - A literal in the code but NOT in the baseline → a NEW hardcoded string was
 *     added. Fails. Route it through `useTranslations` (or, for a genuine
 *     non-string like a brand name, add an `i18n-exempt` line comment).
 *   - A literal in the baseline but NOT in the code → it was migrated. Fails so
 *     the baseline must shrink; run `pnpm --filter @reef/web i18n:baseline` to
 *     prune it. The baseline can only ever get smaller — the prune command
 *     refuses to add new entries, so the only way the guarded count grows is a
 *     hand-edit a reviewer sees in the diff.
 *
 * The guard covers JSX (text nodes + a small set of user-facing attributes) and
 * the message argument of `toast.*()` calls (REEF-299). It deliberately does NOT
 * apply a literal-vs-key heuristic to arbitrary `.ts` data structures (hoisted
 * column-header / field-label arrays rendered via `{expr}`) — that would be far
 * noisier than useful, so those stay copy-free by the review checklist in
 * `packages/web/AGENTS.md`. Type-safe keys (the next-intl `AppConfig`
 * augmentation) plus the catalog parity test cover the missing-key half.
 */

const guardDir = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(guardDir, "../..");
const BASELINE_PATH = path.join(guardDir, "baseline.json");

type Baseline = Record<string, string[]>;

function readBaseline(): Baseline {
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

function writeBaseline(map: Baseline): void {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(map, null, 2)}\n`);
}

/** `a \ b` over the per-file string lists, dropping files that become empty. */
function diff(a: Baseline, b: Baseline): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const file of Object.keys(a).sort()) {
    const other = new Set(b[file] ?? []);
    for (const text of a[file]) {
      if (!other.has(text)) out.push({ file, text });
    }
  }
  return out;
}

/** Keep only baseline entries that are still present in the code (prune only). */
function intersect(baseline: Baseline, current: Baseline): Baseline {
  const out: Baseline = {};
  for (const file of Object.keys(baseline).sort()) {
    const live = new Set(current[file] ?? []);
    const kept = baseline[file].filter((text) => live.has(text)).sort();
    if (kept.length > 0) out[file] = kept;
  }
  return out;
}

function format(entries: Array<{ file: string; text: string }>): string {
  return entries
    .map((e) => `  ${e.file} :: ${JSON.stringify(e.text)}`)
    .join("\n");
}

const updateMode = process.env.I18N_BASELINE_UPDATE;

describe("i18n hardcoded-string guard", () => {
  it("matches the committed baseline (no new hardcoded JSX strings)", () => {
    const current = scanTree(SRC_ROOT);

    if (updateMode === "seed") {
      writeBaseline(current);
      return;
    }
    if (updateMode === "prune") {
      writeBaseline(intersect(readBaseline(), current));
      return;
    }

    const baseline = readBaseline();
    const added = diff(current, baseline);
    const resolved = diff(baseline, current);

    // Messages are only surfaced on failure, so they can always interpolate the
    // offending entries (empty when the lists are empty).
    expect(
      added,
      `New hardcoded user-facing string(s) detected in JSX or a toast() message. Route them through useTranslations(), or add an \`i18n-exempt\` line comment for a genuine non-localized literal (e.g. a brand name):\n${format(added)}`,
    ).toEqual([]);

    expect(
      resolved,
      `These baseline entries are gone — the ratchet must tighten. Run \`pnpm --filter @reef/web i18n:baseline\` to prune them:\n${format(resolved)}`,
    ).toEqual([]);
  });
});
