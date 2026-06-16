"use client";

import { cn } from "@/lib/utils";
import { X } from "lucide-react";

/**
 * Shared close affordance for the issue detail sheet (REEF-111).
 *
 * The sheet opts out of the built-in `SheetContent` close X so it does not
 * overlap the header's issue-actions menu. This button restores a visible
 * close control across every sheet state: the loaded header renders it as an
 * in-flow sibling of the actions menu, while the vault-loading, no-vault,
 * issue-loading, and issue-error states render it pinned top-right (those
 * states have no actions menu, so there is nothing to collide with).
 */
export function IssueDetailCloseButton({
  onClose,
  className,
}: {
  onClose: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid="issue-close"
      aria-label="Close"
      onClick={onClose}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        className,
      )}
    >
      <X className="h-4 w-4" />
    </button>
  );
}
