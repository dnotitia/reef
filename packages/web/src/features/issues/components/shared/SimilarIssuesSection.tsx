"use client";

import { StatusIcon } from "@/components/ui/status-icon";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { ExternalLink, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useSimilarIssues } from "../../hooks/queries/useSimilarIssues";

interface SimilarIssuesSectionProps {
  title: string;
  vault: string;
  className?: string;
}

export function SimilarIssuesSection({
  title,
  vault,
  className,
}: SimilarIssuesSectionProps) {
  const t = useTranslations("issues.create.similar");
  const [dismissedQueries, setDismissedQueries] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { canSearchLiveTitle, issues, isChecking, isError, liveTitle } =
    useSimilarIssues({ title, vault });

  if (!canSearchLiveTitle || dismissedQueries.has(liveTitle)) return null;

  const isUnavailable = !isChecking && isError;
  const hasMatches = !isUnavailable && issues.length > 0;
  const statusLabel = isChecking
    ? t("checking")
    : isUnavailable
      ? t("unavailable")
      : hasMatches
        ? t("topMatches", { count: issues.length })
        : t("noMatches");

  return (
    <section
      aria-label={t("heading")}
      aria-busy={isChecking}
      aria-live="polite"
      data-testid="similar-issues-section"
      className={cn("space-y-1.5", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t("heading")}
          </h3>
          <span
            className="truncate text-muted-foreground/70 text-xs"
            data-testid="similar-issues-status"
          >
            {statusLabel}
          </span>
        </div>
        <button
          type="button"
          aria-label={t("dismissSection")}
          title={t("dismissSection")}
          className="inline-flex size-5 shrink-0 touch-manipulation items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          onClick={() =>
            setDismissedQueries((previous) => {
              const next = new Set(previous);
              next.add(liveTitle);
              return next;
            })
          }
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      {!isChecking && hasMatches ? (
        <ul className="divide-y divide-border-subtle">
          {issues.map((issue) => (
            <li key={issue.id}>
              <a
                href={withVault(vault, `/issues/${issue.id}`)}
                target="_blank"
                rel="noreferrer"
                title={t("openIssue", { id: issue.id })}
                data-testid="similar-issue-row"
                className="group flex min-h-8 min-w-0 touch-manipulation items-center gap-2 rounded-sm py-1.5 text-foreground text-xs hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <StatusIcon status={issue.status} size={12} />
                <span className="shrink-0 font-mono text-muted-foreground group-hover:text-foreground">
                  {issue.id}
                </span>
                <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                <ExternalLink
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground opacity-70"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
