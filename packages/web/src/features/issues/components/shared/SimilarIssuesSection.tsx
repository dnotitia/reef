"use client";

import { StatusIcon } from "@/components/ui/status-icon";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { X } from "lucide-react";
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
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [sectionDismissed, setSectionDismissed] = useState(false);
  const { issues, isError, isSettling } = useSimilarIssues({ title, vault });

  if (sectionDismissed || isError || isSettling) return null;

  const visibleIssues = issues.filter((issue) => !dismissedIds.has(issue.id));
  if (visibleIssues.length === 0) return null;

  return (
    <section
      aria-label={t("heading")}
      data-testid="similar-issues-section"
      className={cn("space-y-2", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t("heading")}
        </h3>
        <button
          type="button"
          aria-label={t("dismissSection")}
          title={t("dismissSection")}
          className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setSectionDismissed(true)}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visibleIssues.map((issue) => (
          <span
            key={issue.id}
            data-testid="similar-issue-chip"
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-subtle bg-background/80 px-2 py-1 text-xs text-foreground shadow-xs"
          >
            <a
              href={withVault(vault, `/issues/${issue.id}`)}
              target="_blank"
              rel="noreferrer"
              title={t("openIssue", { id: issue.id })}
              className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
            >
              <StatusIcon status={issue.status} size={12} decorative />
              <span className="shrink-0 font-mono">{issue.id}</span>
              <span className="truncate">{issue.title}</span>
            </a>
            <button
              type="button"
              aria-label={t("dismissIssue", { id: issue.id })}
              title={t("dismissIssue", { id: issue.id })}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() =>
                setDismissedIds((prev) => new Set(prev).add(issue.id))
              }
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}
