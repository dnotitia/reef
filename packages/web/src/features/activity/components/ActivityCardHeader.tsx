"use client";

import Link from "next/link";
import type { ReactNode } from "react";

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function ActivityTypeBadge({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5",
        "text-[10px] font-semibold uppercase tracking-wide",
        "border-ai-border bg-ai/15 text-ai-subtle-foreground",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export function ActivityCardHeader({
  badge,
  timestamp,
  issueId,
  issueTitle,
  children,
}: {
  badge: ReactNode;
  timestamp: string;
  issueId?: string;
  issueTitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex min-w-0 items-center gap-2">
          <ActivityTypeBadge>{badge}</ActivityTypeBadge>
          {issueId && (
            <Link
              href={`/issues/${issueId}`}
              className="shrink-0 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              {issueId}
            </Link>
          )}
          {issueTitle && (
            <span className="truncate text-xs text-muted-foreground">
              {issueTitle}
            </span>
          )}
        </div>
        {children}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {formatTimestamp(timestamp)}
      </span>
    </div>
  );
}
