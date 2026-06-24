import { STATUS_COLORS } from "@/components/fields/fieldKit";
import { useStatusLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { Status } from "@reef/core";

interface StatusIconProps extends React.SVGProps<SVGSVGElement> {
  status: Status;
  size?: number;
  /**
   * When true the glyph is decorative (aria-hidden, no role/label/title) — pair
   * with a visible label (e.g. `StatusBadge`) so the label is the single
   * accessible name. Defaults to false for icon-only contexts.
   */
  decorative?: boolean;
}

export function StatusIcon({
  status,
  size = 14,
  className,
  decorative = false,
  ...props
}: StatusIconProps) {
  const statusLabels = useStatusLabels();
  return (
    <svg
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : statusLabels[status]}
      aria-hidden={decorative ? true : undefined}
      viewBox="0 0 14 14"
      width={size}
      height={size}
      className={cn("inline-block shrink-0", STATUS_COLORS[status], className)}
      {...props}
    >
      {decorative ? null : <title>{statusLabels[status]}</title>}
      {status === "backlog" && (
        // Faint dotted outline: round-capped zero-length dashes render as dots,
        // distinct from in_review's longer dashes and lighter than `todo`'s
        // solid ring — an uncommitted, not-yet-started stage (REEF-109).
        <circle
          cx="7"
          cy="7"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeDasharray="0.1 2.7"
        />
      )}
      {status === "todo" && (
        <circle
          cx="7"
          cy="7"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      )}
      {status === "in_progress" && (
        <>
          <circle
            cx="7"
            cy="7"
            r="5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M 7 1.5 A 5.5 5.5 0 0 1 7 12.5 Z" fill="currentColor" />
        </>
      )}
      {status === "in_review" && (
        <circle
          cx="7"
          cy="7"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeDasharray="2 1.6"
        />
      )}
      {status === "done" && (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path
            d="M 4 7.2 L 6.2 9.4 L 10 5.4"
            fill="none"
            stroke="white"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {status === "closed" && (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path
            d="M 4.6 4.6 L 9.4 9.4 M 9.4 4.6 L 4.6 9.4"
            fill="none"
            stroke="white"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

interface StatusBadgeProps {
  status: Status;
  size?: number;
  className?: string;
}

export function StatusBadge({ status, size, className }: StatusBadgeProps) {
  const statusLabels = useStatusLabels();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-foreground/80",
        className,
      )}
    >
      <StatusIcon status={status} size={size} decorative />
      <span>{statusLabels[status]}</span>
    </span>
  );
}
