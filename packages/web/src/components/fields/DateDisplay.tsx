/**
 * Shared date renderer. Centralizes locale-aware date formatting + overdue
 * highlight that was inline in two surfaces:
 * - list cell: bare `YYYY-MM-DD` text (format "iso"), or `emptyText` when unset.
 * - board card: a labelled `S`/`D` + `MM-DD` span (format "short") with an
 *   optional destructive overdue pill.
 * The card style is selected by passing a `label`; otherwise it renders plain
 * text so the list-cell DOM is unchanged.
 */
interface DateDisplayProps {
  date: string | null | undefined;
  /** "iso" → YYYY-MM-DD (list); "short" → MM-DD (card). */
  format?: "iso" | "short";
  /** Text rendered when there is no date (e.g. "—"); omit to render nothing. */
  emptyText?: string;
  /** Inline prefix label (e.g. "S", "D") — presence selects the card style. */
  label?: string;
  /** Tooltip prefix → title="Start 2026-06-01". */
  titlePrefix?: string;
  /** Destructive overdue highlight (card style just). */
  overdue?: boolean;
}

const DATE_PART_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;

function formatDateText(date: string, format: "iso" | "short"): string {
  const isoDatePrefix = ISO_DATE_PREFIX.exec(date);
  if (isoDatePrefix) {
    const [, year, month, day] = isoDatePrefix;
    return format === "short" ? `${month}-${day}` : `${year}-${month}-${day}`;
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.valueOf())) return date;

  const parts = DATE_PART_FORMATTER.formatToParts(parsed);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!month || !day) return date;
  if (format === "short") return `${month}-${day}`;
  return year ? `${year}-${month}-${day}` : date;
}

export function DateDisplay({
  date,
  format = "iso",
  emptyText,
  label,
  titlePrefix,
  overdue = false,
}: DateDisplayProps) {
  if (!date) return emptyText ? <>{emptyText}</> : null;
  const text = formatDateText(date, format);

  if (!label) {
    // Plain text (list cell): matches the prior bare-text rendering exactly.
    return <>{text}</>;
  }

  return (
    <span
      title={titlePrefix ? `${titlePrefix} ${date}` : undefined}
      className={
        overdue
          ? "rounded-sm bg-destructive/10 px-1 py-0.5 font-semibold text-destructive"
          : undefined
      }
    >
      <span
        className={overdue ? "text-destructive/70" : "text-muted-foreground/70"}
      >
        {label}
      </span>{" "}
      {text}
    </span>
  );
}
