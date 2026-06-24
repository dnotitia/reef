"use client";

import { useLocale } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Per-locale activity timestamp formatter (REEF-294). UTC-pinned (ADR-0001) so
 * the rendered instant is identical across server and client and follows the
 * app's active locale rather than the viewer's uncontrolled system locale.
 */
const timestampFormatters = new Map<string, Intl.DateTimeFormat>();

function formatTimestamp(iso: string, locale: string): string {
  try {
    let formatter = timestampFormatters.get(locale);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      });
      timestampFormatters.set(locale, formatter);
    }
    return formatter.format(new Date(iso));
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
  const locale = useLocale();
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
        {formatTimestamp(timestamp, locale)}
      </span>
    </div>
  );
}
