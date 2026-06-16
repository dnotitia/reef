import { HighlightText } from "@/components/HighlightText";
import { BlockedBadge } from "@/components/fields/BlockedBadge";
import { TypePill } from "@/components/fields/TypePill";
import { PriorityDot } from "@/components/ui/priority-dot";
import { StatusIcon } from "@/components/ui/status-icon";
import { cn } from "@/lib/utils";
import type { IssueListItem } from "@reef/core";
import { Check } from "lucide-react";

/**
 * Shared option row for issue dropdowns (REEF-032).
 *
 * Brings the kanban-card header rhythm — status icon · monospace id · title ·
 * blocked badge · type pill · priority dot — to the ⌘K palette and the relation
 * combobox so both read like a compressed card instead of a plain-text line.
 * The trailing meta is right-anchored, so the optional blocked badge leads it
 * and the consistently-present type pill + priority dot trail last; that keeps those
 * two columns aligned across rows whether or not a row is blocked.
 *
 * Composed from the existing render leaves imported directly by file (REEF-018:
 * no `components/fields` barrel). Each glyph-bearing leaf carries a `size-*`
 * class so it stays at its intended size inside a cmdk command item, whose
 * ancestor rule sizes `svg:not([class*='size-'])`.
 *
 * Designed to sit inside a flex row (a `CommandItem`); the caller owns the
 * interactive element, hover/active state, and click/keyboard handling.
 */
interface IssueOptionRowProps {
  issue: IssueListItem;
  /** Search needle to highlight inside the id + title (omit for none). */
  query?: string;
  /** Unresolved blocker count; `> 0` renders the blocked badge. */
  blockerCount?: number;
  /** Trailing check for the currently-chosen option (single-select). */
  selected?: boolean;
  className?: string;
}

export function IssueOptionRow({
  issue,
  query = "",
  blockerCount = 0,
  selected = false,
  className,
}: IssueOptionRowProps) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
      <StatusIcon status={issue.status} className="size-3.5 shrink-0" />
      {/* `translate="no"` keeps machine translation from mangling the reef id
          (e.g. browser auto-translate rewriting "REEF-001"); the id is a code
          identifier, not prose. */}
      <span translate="no" className="w-20 shrink-0">
        <HighlightText
          text={issue.id}
          query={query}
          className="font-mono text-xs tabular-nums text-muted-foreground"
        />
      </span>
      <HighlightText
        text={issue.title}
        query={query}
        className="min-w-0 flex-1 truncate text-sm"
      />
      <span className="flex shrink-0 items-center gap-1.5">
        {blockerCount > 0 ? (
          <BlockedBadge variant="list" count={blockerCount} />
        ) : null}
        <TypePill type={issue.issue_type} variant="list" />
        {issue.priority ? <PriorityDot priority={issue.priority} /> : null}
        {selected ? (
          <Check className="size-3.5 text-brand" aria-label="Selected" />
        ) : null}
      </span>
    </div>
  );
}
