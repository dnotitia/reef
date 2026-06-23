import type { Formats } from "next-intl";

/**
 * Shared Intl format presets (skeleton — REEF-291 / ADR-0001).
 *
 * next-intl wraps `Intl.DateTimeFormat` / `Intl.NumberFormat` and resolves
 * these named presets against the active locale, so callers format via
 * `useFormatter().dateTime(date, "short")` instead of hardcoding `en-US` or a
 * `MONTH_NAMES` table. This file only seeds the presets; **applying** them to
 * replace the existing hardcoded date/number formatting is S4's job (REEF
 * follow-up), not S1.
 *
 * Dates stay pinned to UTC (ADR-0001): the per-viewer axis we vary here is the
 * locale, never the time zone — varying TZ per viewer would reintroduce
 * hydration mismatches. `timeZone` is therefore set on the request config, not
 * here.
 */
export const formats = {
  dateTime: {
    short: { year: "numeric", month: "short", day: "numeric" },
  },
  number: {
    integer: { maximumFractionDigits: 0 },
  },
} satisfies Formats;
