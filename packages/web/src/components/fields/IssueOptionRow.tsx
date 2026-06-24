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
 * Brings the kanban-card header rhythm — status icon · monospace id · title ·
 * type · priority — to the ⌘K palette, the relation combobox, the relation
 * chips, and the Sub-issues list so they all read like a compressed card
 * instead of a plain-text line.
 *
 * Laid out as a fixed-track CSS grid, not a flex row (REEF-285). status · id ·
 * title · type · priority are real columns, so the type and priority columns
 * line up across rows whether or not a given row carries a priority or a blocked
 * marker. Solely the title track flexes (`minmax(0,1fr)`) and truncates — a flex
 * row with a `shrink-0` trailing meta block let the title collapse to nothing in
 * narrow columns (the half-width relation column hid the title entirely once a
 * blocked badge appeared); a grid track is unable to.
 *
 * The blocked marker leads the title (inside the flexing title track) so it
 * costs width when the issue is actually blocked, and rendering it there —
 * not in a reserved trailing column — is what keeps the type/priority columns
 * aligned. The priority column is consistently reserved so the dot lines up even on
 * rows without one.
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
      className={cn(
        // `@container` makes the row's own width queryable so the type label can
        // fold to a glyph in a too-narrow column (the half-width relation column)
        // while the wider dropdown and Sub-issues list keep it (REEF-285).
        "@container grid min-w-0 flex-1 items-center gap-x-2",
        // status · id · title · type · priority. Solely the title track flexes and
        // truncates; the priority track is fixed so the dots align across rows.
        "grid-cols-[auto_5rem_minmax(0,1fr)_auto_0.75rem]",
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
      {/* Title track: a compact blocked marker leads the title, the title
          truncates, and the single-select check trails it. Keeping the marker
          and check inside this flexing track (not in reserved columns) is what
          lets the type/priority columns stay aligned across every row. */}
      <span className="flex min-w-0 items-center gap-1.5">
        {blockerCount > 0 ? (
          <BlockedBadge
            variant="compact"
            count={blockerCount}
            className="shrink-0"
          />
        ) : null}
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
        // Below ~16rem of row width the title has no room for both the type label
        // and a blocked marker; fold to a glyph-form type there. `screen-reader` (not
        // `hidden`) so the type name stays in the a11y tree — the glyph is
        // aria-hidden, so display:none would drop the type for screen readers
        // (REEF-285).
        labelClassName="@max-[16rem]:sr-only"
      />
      {/* Priority consistently reserves its column so the dot lines up whether or not
          a sibling row carries one. */}
      <span className="flex justify-center">
        {issue.priority ? <PriorityDot priority={issue.priority} /> : null}
      </span>
    </div>
  );
}
