"use client";

import { SearchProgressBar } from "@/components/ui/SearchProgressBar";
import { StatusIcon } from "@/components/ui/status-icon";
import { useStatusLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { ExternalLink, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
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
  const statusLabels = useStatusLabels();
  const sectionId = useId();
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
      aria-labelledby={`${sectionId}-title`}
      aria-describedby={`${sectionId}-description`}
      aria-busy={isChecking}
      aria-live="polite"
      data-testid="similar-issues-section"
      className={cn("relative space-y-1.5 overflow-hidden pt-1", className)}
    >
      <SearchProgressBar active={isChecking} className="top-0 bottom-auto" />
      <div className="grid grid-cols-[minmax(0,1fr)_1.25rem] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2
            id={`${sectionId}-title`}
            className="shrink-0 text-xs font-medium text-muted-foreground"
          >
            {t("heading")}
          </h2>
          <p
            id={`${sectionId}-description`}
            className="min-w-0 truncate text-muted-foreground/70 text-xs"
            data-testid="similar-issues-status"
          >
            {statusLabel}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("dismissSection")}
          title={t("dismissSection")}
          className="inline-flex size-5 shrink-0 touch-manipulation items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
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
                aria-label={`${statusLabels[issue.status]} ${issue.id} ${issue.title}`}
                title={t("openIssue", { id: issue.id })}
                data-testid="similar-issue-row"
                className="group grid min-h-8 min-w-0 touch-manipulation grid-cols-[minmax(0,1fr)_1.25rem] items-center gap-2 rounded-sm py-1.5 type-caption text-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <StatusIcon status={issue.status} size={12} />
                  <span className="shrink-0 type-mono-value text-muted-foreground group-hover:text-foreground">
                    {issue.id}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                </span>
                <ExternalLink
                  aria-hidden
                  className="size-3.5 justify-self-center text-muted-foreground opacity-70"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
