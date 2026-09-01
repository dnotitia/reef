"use client";

import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type IssueReorderSurfaceState = "pending" | "error";

interface IssueReorderStatusProps {
  state: IssueReorderSurfaceState | null;
  className?: string;
}

/**
 * A compact, motion-independent state marker for the issue being reordered.
 * The parent live region announces the persistence lifecycle; this marker keeps
 * the state attached to the card/row itself for sighted and assistive users.
 */
export function IssueReorderStatus({
  state,
  className,
}: IssueReorderStatusProps) {
  const t = useTranslations("issues.reorder");
  if (!state) return null;
  const label = t(state === "pending" ? "pendingLabel" : "errorLabel");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="issue-reorder-status"
      data-reorder-state={state}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-sm",
        state === "pending"
          ? "text-muted-foreground"
          : "bg-destructive-fill/10 text-destructive-text",
        className,
      )}
    >
      {state === "pending" ? (
        <LoaderCircle
          className="size-3.5 motion-reduce:animate-none animate-spin"
          aria-hidden="true"
        />
      ) : (
        <AlertTriangle className="size-3.5" aria-hidden="true" />
      )}
    </span>
  );
}

export function IssueReorderAnnouncement({ message }: { message: string }) {
  return (
    <output
      data-testid="reorder-persistence-announcement"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </output>
  );
}
