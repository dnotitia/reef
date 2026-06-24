import { cn } from "@/lib/utils";
import { Ban } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Shared "blocked" indicator. Three surfaces render it differently:
 * - `kanban`: a destructive-tinted uppercase pill, no count.
 * - `list`: plain destructive text with the unresolved-blocker count.
 * - `compact`: a destructive glyph + count, no word — for dense issue-option
 *   rows (REEF-285) where the full "Blocked (N)" text crowded out the title.
 *   The full sentence stays in the a11y tree via `role="img"` + `aria-label`,
 *   so the value is encoded once visually (glyph + count) without losing meaning
 *   for assistive tech.
 * The `variant` reproduces each surface's chrome. Layout positioning (e.g.
 * `ml-auto`) stays with the caller via `className`.
 */
interface BlockedBadgeProps {
  variant?: "kanban" | "list" | "compact";
  /** Unresolved blocker count — rendered by the `list` and `compact` variants. */
  count?: number;
  className?: string;
}

export function BlockedBadge({
  variant = "list",
  count,
  className,
}: BlockedBadgeProps) {
  const t = useTranslations("components.blockedBadge");
  if (variant === "compact") {
    const n = count ?? 0;
    const label = t("blockedBy", { count: n });
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex items-center gap-0.5 text-xs font-medium text-destructive",
          className,
        )}
      >
        {/* Glyph + count carry the meaning visually; both are hidden from the
            a11y tree so the role="img" aria-label is the single accessible name. */}
        <Ban className="size-3.5 shrink-0" aria-hidden="true" />
        <span aria-hidden="true" className="tabular-nums">
          {n > 9 ? "9+" : n}
        </span>
      </span>
    );
  }
  if (variant === "kanban") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive",
          className,
        )}
        title={t("blocked")}
      >
        <span
          className="inline-block h-1 w-1 rounded-full bg-destructive"
          aria-hidden="true"
        />
        {t("blocked")}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium text-destructive whitespace-nowrap",
        className,
      )}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-destructive"
        aria-hidden="true"
      />
      {t("blockedCount", { count: count ?? 0 })}
    </span>
  );
}
