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
 * Brings the kanban-card header rhythm — status icon · id/title summary ·
 * type · priority · blocker — to the ⌘K palette, the relation combobox, selected relation
 * rows, and the Sub-issues list so they all read like a compressed card
 * instead of a plain-text line.
 *
 * Laid out as a grid, not a flex row (REEF-285). status · summary ·
 * metadata are real tracks, and metadata has its own tight grid for type,
 * priority, and blocker so those glyphs keep a consistent visual gap
 * across rows whether or not a given row carries a priority or a blocked
 * marker. Solely the title track flexes (`minmax(0,1fr)`) and truncates — a
 * flex row with a `shrink-0` trailing meta block let the title collapse to
 * nothing in narrow columns (the half-width relation column hid the title
 * entirely once a blocked badge appeared); a grid track is unable to.
 *
 * The id and title share one summary track so the issue key reads directly into
 * the title instead of leaving a table-like gutter. The blocked marker lives in
 * a trailing metadata track (REEF-397), away from that id/title summary so
 * relation rows do not read it as the relation type. In this dense option-row
 * context, the marker keeps the same destructive blocked color language as the
 * kanban card state, but at lower emphasis: it remains available metadata and
 * accessible as "blocked by N" without becoming the row's visual anchor ahead
 * of the issue id/title. Empty rows keep the trailing blocker slot blank, so
 * blocker/no-blocker siblings do not shift, and the priority column is
 * consistently reserved so the dot lines up even on rows without one.
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
        "@container grid min-w-0 flex-1 items-center gap-x-1.5",
        // status · id/title summary · metadata. The summary track flexes and
        // truncates the title; metadata owns its internal type/priority/blocker
        // spacing so different slot widths do not create uneven visual gutters.
        "grid-cols-[auto_minmax(0,1fr)_auto]",
        className,
      )}
    >
      <StatusIcon status={issue.status} className="size-3.5" />
      <span
        data-issue-option-slot="summary"
        className="flex min-w-0 items-center gap-2"
      >
        <span
          data-issue-option-slot="identity"
          translate="no"
          className="shrink-0 overflow-hidden"
        >
          {/* `translate="no"` keeps machine translation from mangling the reef id
              (e.g. browser auto-translate rewriting "REEF-001"); the id is a code
              identifier, not prose. */}
          <HighlightText
            text={issue.id}
            query={query}
            className="block truncate font-mono text-xs tabular-nums text-muted-foreground"
          />
        </span>
        {/* Title track: solely the title text flexes and truncates. The optional
            single-select check trails the text without changing the title's start
            inside the summary flow. */}
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
      </span>
      <span
        data-issue-option-slot="metadata"
        className="grid shrink-0 grid-cols-[auto_0.75rem_minmax(1rem,auto)] items-center gap-x-1.5"
      >
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
        {/* Priority consistently reserves its column so the dot lines up whether
            or not a sibling row carries one. */}
        <span data-issue-option-slot="priority" className="flex justify-center">
          {issue.priority ? <PriorityDot priority={issue.priority} /> : null}
        </span>
        <span
          data-issue-option-slot="blocker"
          className="flex min-w-4 shrink-0 justify-start"
        >
          {blockerCount > 0 ? (
            <BlockedBadge
              variant="compact"
              count={blockerCount}
              className="shrink-0 gap-0 text-[10px] font-normal leading-none text-destructive/50 [&>svg]:size-2.5"
            />
          ) : null}
        </span>
      </span>
    </div>
  );
}
