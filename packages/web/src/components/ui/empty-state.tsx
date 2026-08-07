import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

export type EmptyStateVariant = "structure" | "section";

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Use structure when the page cannot be composed without a prerequisite. */
  variant?: EmptyStateVariant;
  /** Optional section heading. Rendered as the semantic h2 for the state. */
  title?: ReactNode;
  /** Supporting copy for the state. */
  description?: ReactNode;
  /** An icon or other visual that is always decorative. */
  icon?: ReactNode;
  /** An existing Link, Button, or other action node. */
  action?: ReactNode;
}

const SECTION_FRAME =
  "rounded-lg border border-dashed border-border-subtle bg-surface-subtle px-6 py-12 text-center";
const STRUCTURE_FRAME =
  "flex flex-1 items-center justify-center px-6 py-12 text-center";

export function EmptyState({
  variant = "section",
  title,
  description,
  icon,
  action,
  className,
  ...props
}: EmptyStateProps) {
  const hasIcon = icon !== undefined && icon !== null;
  const hasTitle = title !== undefined && title !== null;
  const hasDescription = description !== undefined && description !== null;
  const hasAction = action !== undefined && action !== null;

  return (
    <div
      data-slot="empty-state"
      className={cn(
        variant === "structure" ? STRUCTURE_FRAME : SECTION_FRAME,
        className,
      )}
      {...props}
    >
      <div className="flex flex-col items-center">
        {hasIcon ? (
          <span
            data-slot="empty-state-icon"
            aria-hidden="true"
            className="mb-3 flex items-center justify-center text-muted-foreground"
          >
            {icon}
          </span>
        ) : null}
        {hasTitle ? (
          <h2 className="text-pretty text-sm font-semibold text-foreground">
            {title}
          </h2>
        ) : null}
        {hasDescription ? (
          <p
            className={cn(
              "text-pretty text-sm text-muted-foreground",
              hasTitle && "mt-1",
            )}
          >
            {description}
          </p>
        ) : null}
        {hasAction ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}
