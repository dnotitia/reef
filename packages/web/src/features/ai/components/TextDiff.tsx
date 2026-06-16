"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { type DiffSegment, lineDiff, wordDiff } from "../lib/textDiff";

/** Stable keys without using the array index (Biome `noArrayIndexKey`). */
function withKeys(
  segments: DiffSegment[],
): { key: string; segment: DiffSegment }[] {
  return segments.reduce<{
    items: { key: string; segment: DiffSegment }[];
    offset: number;
  }>(
    (acc, segment) => ({
      items: [...acc.items, { key: `${segment.type}@${acc.offset}`, segment }],
      offset: acc.offset + segment.text.length + 1,
    }),
    { items: [], offset: 0 },
  ).items;
}

const SEGMENT_CLASS: Record<DiffSegment["type"], string> = {
  equal: "text-foreground/70",
  remove: "text-muted-foreground line-through decoration-muted-foreground/50",
  add: "rounded bg-ai-subtle px-0.5 text-ai-subtle-foreground",
};

/** Inline word-level diff — used for the single-line title field. */
export function InlineWordDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const keyed = withKeys(wordDiff(before, after));
  return (
    <p className="text-xs leading-relaxed">
      {keyed.map(({ key, segment }, index) => (
        <span key={key} className={SEGMENT_CLASS[segment.type]}>
          {segment.text}
          {index < keyed.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}

const COLLAPSED_LINES = 6;

/**
 * Unified line-level diff for the multi-line body field. Collapsed by default
 * to the first `COLLAPSED_LINES` rendered lines with an expand toggle, so a
 * full description rewrite doesn't flood the dialog.
 */
export function CollapsibleLineDiff({
  before,
  after,
  fieldTestId,
}: {
  before: string;
  after: string;
  fieldTestId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = lineDiff(before, after).flatMap(({ type, text }) =>
    text.split("\n").map((line) => ({ type, line })),
  );
  const keyedRows = rows.reduce<{
    items: { key: string; type: DiffSegment["type"]; line: string }[];
    offset: number;
  }>(
    (acc, { type, line }) => ({
      items: [...acc.items, { key: `${type}@${acc.offset}`, type, line }],
      offset: acc.offset + line.length + 1,
    }),
    { items: [], offset: 0 },
  ).items;

  const visible = expanded ? keyedRows : keyedRows.slice(0, COLLAPSED_LINES);
  const hiddenCount = keyedRows.length - visible.length;

  return (
    <div className="overflow-hidden rounded-md border border-ai-border">
      <div className="divide-y divide-ai-border/40">
        {visible.map(({ key, type, line }) => (
          <div
            key={key}
            className={cn(
              "flex gap-2 px-2 py-1 font-mono text-[11px] leading-snug",
              type === "remove" && "bg-muted/40 text-muted-foreground",
              type === "add" && "bg-ai-subtle text-ai-subtle-foreground",
              type === "equal" && "text-foreground/60",
            )}
          >
            <span aria-hidden="true" className="select-none opacity-60">
              {type === "add" ? "+" : type === "remove" ? "−" : " "}
            </span>
            <span className="whitespace-pre-wrap break-words">
              {line || " "}
            </span>
          </div>
        ))}
      </div>
      {(hiddenCount > 0 || expanded) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start rounded-none border-t border-ai-border text-[11px] text-ai-subtle-foreground"
          onClick={() => setExpanded((prev) => !prev)}
          data-testid={`field-suggestion-diff-toggle-${fieldTestId}`}
        >
          {expanded ? "▴ Collapse" : `▾ Show full change (${hiddenCount} more)`}
        </Button>
      )}
    </div>
  );
}
