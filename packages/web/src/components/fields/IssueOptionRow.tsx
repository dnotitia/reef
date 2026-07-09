import { HighlightText } from "@/components/HighlightText";
import { BlockedBadge } from "@/components/fields/BlockedBadge";
import { TypePill } from "@/components/fields/TypePill";
import { PriorityDot } from "@/components/ui/priority-dot";
import { StatusIcon } from "@/components/ui/status-icon";
import { cn } from "@/lib/utils";
import type { IssueListItem } from "@reef/core";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Shared option row for issue dropdowns (REEF-032).
 *
 * Brings the kanban-card header rhythm — status icon · monospace id · blocker ·
 * title · type · priority — to the ⌘K palette, the relation combobox, selected relation
 * rows, and the Sub-issues list so they all read like a compressed card
 * instead of a plain-text line.
 *
 * Laid out as a fixed-track CSS grid, not a flex row (REEF-285). status · id ·
 * blocker · title · type · priority are real columns, so the type and priority columns
 * line up across rows whether or not a given row carries a priority or a blocked
 * marker. Solely the title track flexes (`minmax(0,1fr)`) and truncates — a flex
 * row with a `shrink-0` trailing meta block let the title collapse to nothing in
 * narrow columns (the half-width relation column hid the title entirely once a
 * blocked badge appeared); a grid track is unable to.
 *
 * The blocked marker owns a fixed column before the title. Empty rows keep that
 * slot blank, so every title starts from the same grid line and the slot's
 * meaning stays visible. The priority column is consistently reserved so the dot
 * lines up even on rows without one.
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
  /** Unresolved blocker count; `> 0` renders the blocked marker. */
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
  const t = useTranslations("components.issueOption");
  return (
    <div
      data-issue-option-row=""
      className={cn(
        // `@container` makes the row's own width queryable so the type label can
        // fold to a glyph in a too-narrow column (the half-width relation column)
        // while the wider dropdown and Sub-issues list keep it (REEF-285).
        "@container grid min-w-0 flex-1 items-center gap-x-2",
        // status · id · blocker · title · type · priority. Solely the title
        // track flexes and truncates; the blocker and priority tracks are fixed
        // so their markers align across rows whether present or absent.
        "grid-cols-[auto_5rem_1.875rem_minmax(0,1fr)_auto_0.75rem]",
        className,
      )}
    >
      <StatusIcon status={issue.status} className="size-3.5" />
      {/* `translate="no"` keeps machine translation from mangling the reef id
          (e.g. browser auto-translate rewriting "REEF-001"); the id is a code
          identifier, not prose. */}
      <span translate="no" className="min-w-0">
        <HighlightText
          text={issue.id}
          query={query}
          className="font-mono text-xs tabular-nums text-muted-foreground"
        />
      </span>
      <span
        data-issue-option-slot="blocker"
        className="flex min-w-0 justify-center"
      >
        {blockerCount > 0 ? (
          <BlockedBadge
            variant="compact"
            count={blockerCount}
            className="max-w-full shrink-0"
          />
        ) : null}
      </span>
      {/* Title track: solely this track flexes and truncates. The optional
          single-select check trails the text without changing the title's start
          grid line. */}
      <span
        data-issue-option-slot="title"
        className="flex min-w-0 items-center gap-1.5"
      >
        <HighlightText
          text={issue.title}
          query={query}
          className="min-w-0 flex-1 truncate text-sm"
        />
        {selected ? (
          <Check
            className="size-3.5 shrink-0 text-brand"
            aria-label={t("selected")}
          />
        ) : null}
      </span>
      <TypePill
        type={issue.issue_type}
        variant="list"
        // In dense relation rows, every issue type reads as a bare glyph so the
        // type column keeps one visual weight regardless of epic/story/task/bug
        // mix (REEF-376). The label stays sr-only, not hidden, because the glyph
        // itself is decorative and screen readers still need the type name.
        className="border-0 bg-transparent px-0 py-0"
        labelClassName="sr-only"
      />
      {/* Priority consistently reserves its column so the dot lines up whether or not
          a sibling row carries one. */}
      <span className="flex justify-center">
        {issue.priority ? <PriorityDot priority={issue.priority} /> : null}
      </span>
    </div>
  );
}
