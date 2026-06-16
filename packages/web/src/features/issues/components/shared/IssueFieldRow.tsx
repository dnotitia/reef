"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Fixed-width leading label so every value column starts at the same x and
 *  receives the full remaining rail width (no `grid-cols-2` half-cells). */
const ROW_LABEL_CLASS =
  "w-20 shrink-0 text-xs font-medium text-muted-foreground";

interface IssueFieldRowProps {
  /** Visible label text, rendered verbatim. Omit when supplying `labelSlot`. */
  label?: string;
  /**
   * Associate the label with a focusable control via `htmlFor` (renders a
   * `<label>`). Use this for inputs/comboboxes/date pickers whose own element
   * carries the matching `id`.
   */
  htmlFor?: string;
  /**
   * Associate the label by id for controls that consume `aria-labelledby`
   * instead of `htmlFor` (e.g. the Radix `<Select>` trigger in
   * `EnumSelectField`). Renders a `<span id>` rather than a `<label>`.
   */
  labelId?: string;
  /**
   * Custom label node, used when the label element should vary at render time —
   * e.g. the create-dialog rail swaps `<label htmlFor>` ↔ `<span>` depending on
   * whether a field has a pending AI suggestion (so an `htmlFor` does not dangles
   * onto a control the suggestion UI replaced). Takes precedence over
   * `label`/`htmlFor`/`labelId`. The row still owns the fixed-width gutter, so
   * every value column starts at the same x; the slot content supplies its own
   * text styling.
   */
  labelSlot?: ReactNode;
  /** Cross-axis alignment; `start` for multi-line values (e.g. wrapping chips). */
  align?: "center" | "start";
  children: ReactNode;
}

/**
 * One row of the issue detail rail's property list: a fixed-width label on the
 * left and the value control filling the rest (REEF-149). Replaces the prior
 * `grid grid-cols-2` sub-grids whose ~134px half-cells truncated dates and
 * planning-item names. The value wrapper is `min-w-0 flex-1` so the control
 * (already `w-full`) stretches to the full column and its own truncation just
 * bites on genuinely long content.
 *
 * Co-located in `shared/` (not a `fields/` leaf and not behind a barrel) so the
 * create-dialog rail can adopt the same row later without merging field leaves.
 */
export function IssueFieldRow({
  label,
  htmlFor,
  labelId,
  labelSlot,
  align = "center",
  children,
}: IssueFieldRowProps) {
  return (
    <div
      data-slot="issue-field-row"
      // `min-w-0` is load-bearing: this row is a grid/flex item of its parent
      // section, whose default `min-width: auto` would let a long value (e.g. a
      // milestone name) grow the row to its content width and overflow the rail.
      // Shrinking to 0 lets the inner value column truncate within the rail
      // instead.
      className={cn(
        "flex min-w-0 gap-2",
        align === "start" ? "items-start" : "items-center",
      )}
    >
      {labelSlot ? (
        // Caller-supplied label element (e.g. an enrichment-aware label that
        // flips between `<label htmlFor>` and `<span>`); the row keeps owning
        // the fixed-width gutter so value columns stay aligned across rows.
        <div className="w-20 shrink-0">{labelSlot}</div>
      ) : htmlFor ? (
        <label htmlFor={htmlFor} className={ROW_LABEL_CLASS}>
          {label}
        </label>
      ) : (
        <span id={labelId} className={ROW_LABEL_CLASS}>
          {label}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
