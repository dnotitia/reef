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
  const [sectionDismissed, setSectionDismissed] = useState(false);
  const { issues, isError, isSettling } = useSimilarIssues({ title, vault });

  if (sectionDismissed || isError || isSettling) return null;

  if (issues.length === 0) return null;

  return (
    <section
      aria-label={t("heading")}
      data-testid="similar-issues-section"
      className={cn("space-y-1.5", className)}
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
      <ul className="divide-y divide-border-subtle">
        {issues.map((issue) => (
          <li key={issue.id}>
            <a
              href={withVault(vault, `/issues/${issue.id}`)}
              target="_blank"
              rel="noreferrer"
              title={t("openIssue", { id: issue.id })}
              data-testid="similar-issue-row"
              className="group flex min-h-8 min-w-0 items-center gap-2 py-1.5 text-xs text-foreground hover:text-foreground"
            >
              <StatusIcon status={issue.status} size={12} decorative />
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
    </section>
  );
}
