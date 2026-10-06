"use client";

import { linkSafetyConfig } from "@/components/markdown/linkSafety";
import { PlanningStatusBadge } from "@/components/fields/PlanningStatusBadge";
import { StatusBadge } from "@/components/ui/status-icon";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { buildOpenIssueHref } from "@/features/issues/lib/issueHref";
import { cn } from "@/lib/utils";
import {
  computePlanningRollup,
  type IssueListItem,
  type Milestone,
  type PlanningRollup as PlanningRollupData,
  type Release,
} from "@reef/core";
import { ArrowUpRight, ChevronLeft, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Streamdown } from "streamdown";
import { useMemo, useRef } from "react";
import { usePlanningKindSingularLabels } from "@/i18n/fieldLabels";
import type { PlanningKind } from "../hooks/usePlanningCatalog";
import { planningIssueFilterHref, planningListHref } from "../lib/planningUrls";
import { PlanningDates } from "./PlanningDates";
import { PlanningRollup, type IssueAggregationState } from "./PlanningRollup";

type PlanningDetailItem = Milestone | Release;

const ISSUE_PREVIEW_LIMIT = 5;

function issueFilterField(kind: "milestones" | "releases") {
  return kind === "milestones" ? "milestone_id" : "release_id";
}

export function PlanningDetailPanel({
  open,
  vault,
  kind,
  item,
  issues,
  issueAggregationState,
  isIssueFetching,
  onClose,
  onRetryIssues,
}: {
  open: boolean;
  vault: string;
  kind: "milestones" | "releases";
  item: PlanningDetailItem | undefined;
  issues: readonly IssueListItem[] | undefined;
  issueAggregationState: IssueAggregationState;
  isIssueFetching: boolean;
  onClose: () => void;
  onRetryIssues: () => void;
}) {
  const t = useTranslations("planning");
  const common = useTranslations("common");
  const detail = useTranslations("planning.detail");
  const kindSingularLabels = usePlanningKindSingularLabels();
  const openerIdRef = useRef<string | undefined>(undefined);
  const displayIssueState: IssueAggregationState =
    issueAggregationState === "available" && !issues
      ? "unavailable"
      : issueAggregationState;
  const rollup = useMemo<PlanningRollupData | undefined>(() => {
    if (!item || displayIssueState !== "available" || !issues) {
      return undefined;
    }
    return computePlanningRollup(kind, [item], issues).get(item.id);
  }, [displayIssueState, issues, item, kind]);
  const linkedIssues = useMemo(() => {
    if (!item || displayIssueState !== "available" || !issues) return [];
    const field = issueFilterField(kind);
    return issues.filter((issue) => issue[field] === item.id);
  }, [displayIssueState, issues, item, kind]);
  const markdown = item
    ? kind === "milestones"
      ? ((item as Milestone).description?.trim() ?? "")
      : ((item as Release).notes?.trim() ?? "")
    : "";
  const markdownHeading =
    kind === "milestones" ? detail("description") : detail("releaseNotes");
  const preview = linkedIssues.slice(0, ISSUE_PREVIEW_LIMIT);
  const openerId = item ? `planning-item-${kind}-${item.id}` : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SheetContent
        data-testid="planning-detail-panel"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-xl"
        onOpenAutoFocus={() => {
          openerIdRef.current = openerId;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const openerId = openerIdRef.current;
          const focusTarget =
            (openerId ? document.getElementById(openerId) : null) ??
            document.querySelector<HTMLElement>(
              `[data-testid="planning-kind-${kind}"]`,
            );
          focusTarget?.focus();
          openerIdRef.current = undefined;
        }}
      >
        <SheetHeader className="flex-row items-start justify-between gap-4 border-b border-border-subtle p-5 pr-4">
          <div className="min-w-0">
            <SheetTitle className="break-words">
              {item?.name ??
                detail("itemNotFoundTitle", {
                  kind: kindSingularLabels[kind],
                })}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {item
                ? detail("panelDescription", {
                    kind: kindSingularLabels[kind].toLowerCase(),
                  })
                : detail("itemNotFoundDescription", {
                    kind: kindSingularLabels[kind].toLowerCase(),
                  })}
            </SheetDescription>
            {item ? (
              <div className="mt-2">
                <PlanningStatusBadge kind={kind} status={item.status} />
              </div>
            ) : null}
          </div>
          <SheetClose asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={common("close")}
              className="shrink-0"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </Button>
          </SheetClose>
        </SheetHeader>

        {item ? (
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
            <section aria-labelledby="planning-detail-dates-heading">
              <h2
                id="planning-detail-dates-heading"
                className="type-section-label text-muted-foreground"
              >
                {t("dates")}
              </h2>
              <div className="mt-2 text-sm tabular-nums">
                <PlanningDates
                  kind={kind}
                  item={item}
                  emptyText={detail("noDate")}
                />
              </div>
            </section>

            <section aria-labelledby="planning-detail-description-heading">
              <h2
                id="planning-detail-description-heading"
                className="type-section-label text-muted-foreground"
              >
                {markdownHeading}
              </h2>
              {markdown ? (
                <Streamdown
                  linkSafety={linkSafetyConfig}
                  className="reef-markdown-surface mt-2 min-w-0 break-words text-sm text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                >
                  {markdown}
                </Streamdown>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {detail("noDescription")}
                </p>
              )}
            </section>

            <section aria-labelledby="planning-detail-issues-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id="planning-detail-issues-heading"
                  className="type-section-label text-muted-foreground"
                >
                  {detail("linkedIssues")}
                </h2>
                {displayIssueState === "available" ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {detail("linkedIssueCount", { count: linkedIssues.length })}
                  </span>
                ) : null}
              </div>

              <div className="mt-2">
                <PlanningRollup
                  vault={vault}
                  kind={kind}
                  item={item}
                  rollup={rollup}
                  state={displayIssueState}
                  interactive={false}
                />
              </div>

              {displayIssueState === "unavailable" ? (
                <div
                  className="mt-3 rounded-md border border-border-subtle bg-surface-subtle p-3"
                  role="alert"
                >
                  <p className="text-sm text-muted-foreground">
                    {t("issueLoadErrorDescription")}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={onRetryIssues}
                    disabled={isIssueFetching}
                  >
                    {common("retry")}
                  </Button>
                </div>
              ) : null}

              {displayIssueState === "available" ? (
                linkedIssues.length > 0 ? (
                  <ul
                    data-testid="planning-linked-issue-preview"
                    className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle"
                  >
                    {preview.map((issue) => (
                      <li key={issue.id}>
                        <Link
                          href={buildOpenIssueHref(
                            vault,
                            issue.id,
                            new URLSearchParams(),
                          )}
                          className={cn(
                            "flex min-w-0 items-center gap-3 px-3 py-2.5",
                            "rounded-sm hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus",
                          )}
                        >
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {issue.id}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {issue.title}
                          </span>
                          <StatusBadge
                            status={issue.status}
                            className="shrink-0"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 rounded-md bg-surface-subtle px-3 py-3 text-sm text-muted-foreground">
                    {detail("noLinkedIssues")}
                  </p>
                )
              ) : null}

              <Link
                href={planningIssueFilterHref(vault, kind, item.id)}
                className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded text-sm font-medium text-brand-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
              >
                {detail("viewAllLinkedIssues")}
                <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            </section>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-start gap-3 p-5">
            <p className="text-sm text-muted-foreground">
              {detail("itemNotFoundDescription", {
                kind: kindSingularLabels[kind].toLowerCase(),
              })}
            </p>
            <Link
              href={planningListHref(vault, kind)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded font-medium text-brand-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              {detail("backToPlanning")}
            </Link>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
