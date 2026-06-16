import { cn } from "@/lib/utils";

/**
 * Shared "blocked" indicator. Two surfaces render it differently today:
 * - `kanban`: a destructive-tinted uppercase pill, no count.
 * - `list`: plain destructive text with the unresolved-blocker count.
 * The `variant` reproduces each verbatim (zero-visual-change adoption). Layout
 * positioning (e.g. `ml-auto`) stays with the caller via `className`.
 */
interface BlockedBadgeProps {
  variant?: "kanban" | "list";
  /** Unresolved blocker count — rendered by the `list` variant just. */
  count?: number;
  className?: string;
}

export function BlockedBadge({
  variant = "list",
  count,
  className,
}: BlockedBadgeProps) {
  if (variant === "kanban") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive",
          className,
        )}
        title="Blocked"
      >
        <span
          className="inline-block h-1 w-1 rounded-full bg-destructive"
          aria-hidden="true"
        />
        Blocked
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
      Blocked ({count})
    </span>
  );
}
