"use client";

import { cn } from "@/lib/utils";
import { Fragment } from "react";

interface HighlightTextProps {
  text: string;
  /** Case-insensitive needle. Empty string or whitespace renders text unchanged. */
  query: string;
  className?: string;
}

/**
 * Renders `text` with every case-insensitive occurrence of `query` wrapped
 * in a `<mark>` so search/relation surfaces can show which substring matched.
 *
 * Returns plain text when the query is empty so callers can pass the same
 * component unconditionally without conditional rendering at the call site.
 *
 * Shared UI leaf (REEF-032): consumed by the ⌘K palette and the issue-option
 * row, so it lives in `components/` rather than a feature folder to keep the
 * dependency direction one-way (shared ← features, does not the reverse).
 */
export function HighlightText({ text, query, className }: HighlightTextProps) {
  const trimmed = query.trim();
  if (!trimmed) return <span className={className}>{text}</span>;

  const needle = trimmed.toLowerCase();
  const haystack = text.toLowerCase();
  const parts: Array<{ value: string; match: boolean }> = [];

  let cursor = 0;
  while (cursor < text.length) {
    const idx = haystack.indexOf(needle, cursor);
    if (idx < 0) {
      parts.push({ value: text.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) {
      parts.push({ value: text.slice(cursor, idx), match: false });
    }
    parts.push({
      value: text.slice(idx, idx + needle.length),
      match: true,
    });
    cursor = idx + needle.length;
  }

  return (
    <span className={className}>
      {parts.map((part, i) => {
        // Keys combine position + value: stable within a render, and the entire
        // list is rebuilt whenever `text` or `query` change anyway.
        const key = `${i}:${part.match ? "m" : "p"}:${part.value}`;
        return part.match ? (
          <mark
            key={key}
            className={cn(
              "bg-brand/20 text-foreground rounded-sm px-0.5",
              "[font-weight:inherit]",
            )}
          >
            {part.value}
          </mark>
        ) : (
          <Fragment key={key}>{part.value}</Fragment>
        );
      })}
    </span>
  );
}
