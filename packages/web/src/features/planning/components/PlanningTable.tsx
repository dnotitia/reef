"use client";

import { MarkdownEditor } from "@/components/MarkdownEditor";
import { DateDisplay } from "@/components/fields/DateDisplay";
import { PlanningStatusBadge } from "@/components/fields/PlanningStatusBadge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useFieldNameLabels,
  usePlanningKindLabels,
  usePlanningKindSingularLabels,
} from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type {
  IssueListItem,
  Milestone,
  PlanningCatalog,
  Release,
  Sprint,
} from "@reef/core";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useId, useMemo, useState } from "react";
import type { PlanningItem, PlanningKind } from "../hooks/usePlanningCatalog";
import { countIssuesByPlanningId, itemsForKind } from "../lib/planningItems";

export type IssueAggregationState = "loading" | "unavailable" | "available";

const MARKDOWN_TOKENS = /[#>*_`~]+|\[([^\]]*)\]\([^)]*\)/g;
const NOOP = () => {};

function stripMarkdown(md: string): string {
  const firstLine = md.split("\n").find((line) => line.trim()) ?? "";
  return firstLine.replace(MARKDOWN_TOKENS, "$1").replace(/\s+/g, " ").trim();
}

function detailBody(kind: PlanningKind, item: PlanningItem): string {
  if (kind === "sprints") return (item as Sprint).goal ?? "";
  if (kind === "milestones") return (item as Milestone).description ?? "";
  return (item as Release).notes ?? "";
}

export function PlanningTable({
  catalog,
  kind,
  issues,
  isLoading,
  isCatalogError,
  isCatalogFetching,
  onRetryCatalog,
  issueAggregationState,
  isIssueFetching,
  onRetryIssues,
  expandedId,
  onEdit,
  onExpandedIdChange,
  onRequestDelete,
  deletingId,
}: {
  catalog: PlanningCatalog | undefined;
  kind: PlanningKind;
  issues: readonly IssueListItem[] | undefined;
  isLoading: boolean;
  isCatalogError: boolean;
  isCatalogFetching: boolean;
  onRetryCatalog: () => void;
  issueAggregationState: IssueAggregationState;
  isIssueFetching: boolean;
  onRetryIssues: () => void;
  expandedId: string | null;
  onEdit: (kind: PlanningKind, item: PlanningItem) => void;
  onExpandedIdChange: (id: string | null) => void;
  onRequestDelete: (kind: PlanningKind, item: PlanningItem) => void;
  deletingId?: string;
}) {
  const planningKindLabels = usePlanningKindLabels();
  const planningKindSingular = usePlanningKindSingularLabels();
  const fieldNames = useFieldNameLabels();
  const t = useTranslations("planning");
  const sections = useTranslations("sections");
  const items = itemsForKind(catalog, kind);
  const countById = useMemo(
    () =>
      issueAggregationState === "available" && issues
        ? countIssuesByPlanningId(issues, kind)
        : undefined,
    [issueAggregationState, issues, kind],
  );
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsCompact(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-11/12" />
      </div>
    );
  }

  if (isCatalogError) {
    return (
      <PlanningCatalogError
        isFetching={isCatalogFetching}
        onRetry={onRetryCatalog}
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        data-testid={`planning-empty-${kind}`}
        title={t("emptyKindTitle", {
          kind: planningKindLabels[kind].toLowerCase(),
        })}
        description={t("emptyKindDescription", {
          kind: planningKindSingular[kind].toLowerCase(),
        })}
      />
    );
  }

  const issueError =
    issueAggregationState === "unavailable" ? (
      <PlanningIssueAggregationError
        isFetching={isIssueFetching}
        onRetry={onRetryIssues}
      />
    ) : null;

  if (isCompact) {
    return (
      <>
        {issueError}
        <PlanningCompactList
          items={items}
          kind={kind}
          countById={countById}
          issueAggregationState={issueAggregationState}
          expandedId={expandedId}
          onEdit={onEdit}
          onExpandedIdChange={onExpandedIdChange}
          onRequestDelete={onRequestDelete}
          deletingId={deletingId}
        />
      </>
    );
  }

  return (
    <>
      {issueError}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{fieldNames.status}</TableHead>
            <TableHead>{t("dates")}</TableHead>
            <TableHead>{t("issues")}</TableHead>
            <TableHead>{sections("details")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const count = countById?.get(item.id);
            const isDeleting = deletingId === item.id;
            const body = detailBody(kind, item);
            const summary = body ? stripMarkdown(body) : "";
            const isExpanded = expandedId === item.id;
            const panelId = `planning-detail-${item.id}`;
            return (
              <Fragment key={item.id}>
                <TableRow className="transition-colors duration-150 hover:bg-surface-hover">
                  <TableCell className="max-w-xs font-medium">
                    {body ? (
                      // REEF-264: chevron + title are one disclosure button so the
                      // whole name is the hit target and the panel has a single
                      // aria-expanded control. The row supplies the surface hover;
                      // the chevron darkens on group-hover to mark this strip as the
                      // toggle. Scoped to the Name cell — the row is not clickable.
                      <button
                        type="button"
                        onClick={() =>
                          onExpandedIdChange(isExpanded ? null : item.id)
                        }
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        aria-label={
                          isExpanded
                            ? t("collapseDetails", { name: item.name })
                            : t("expandDetails", { name: item.name })
                        }
                        className="group/disclosure flex w-full min-w-0 items-center gap-1.5 rounded text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover/disclosure:text-foreground">
                          <ChevronRight
                            aria-hidden="true"
                            className={cn(
                              "h-3.5 w-3.5 transition-transform motion-reduce:transition-none",
                              isExpanded && "rotate-90",
                            )}
                          />
                        </span>
                        <span className="min-w-0 line-clamp-1">
                          {item.name}
                        </span>
                      </button>
                    ) : (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="w-5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 line-clamp-1">
                          {item.name}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <PlanningStatusBadge kind={kind} status={item.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    <PlanningDates kind={kind} item={item} />
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    <IssueCount count={count} state={issueAggregationState} />
                  </TableCell>
                  <TableCell className="max-w-sm text-sm text-muted-foreground">
                    <span className="line-clamp-1" title={summary || undefined}>
                      {summary || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        hitTarget="compact"
                        variant="ghost"
                        onClick={() => onEdit(kind, item)}
                        disabled={isDeleting}
                        aria-label={t("editItem", { name: item.name })}
                      >
                        <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                      </Button>
                      <PlanningDeleteAction
                        itemName={item.name}
                        issueCount={count}
                        state={issueAggregationState}
                        isDeleting={isDeleting}
                        onRequestDelete={() => onRequestDelete(kind, item)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
                {isExpanded && body && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={6}
                      className="whitespace-normal break-words bg-surface-subtle/40 py-3"
                    >
                      <div id={panelId} className="px-1">
                        <MarkdownEditor
                          value={body}
                          onChange={NOOP}
                          readOnly
                          ariaLabel={t("itemDetails", { name: item.name })}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}

/**
 * At widths below the desktop table contract, keep every planning field and
 * both row actions in one bounded card. This is intentionally local to
 * PlanningTable: the desktop table and shared Table primitive stay unchanged,
 * while keyboard and touch users never need to discover an off-screen action
 * column.
 */
function PlanningCompactList({
  items,
  kind,
  countById,
  issueAggregationState,
  expandedId,
  onEdit,
  onExpandedIdChange,
  onRequestDelete,
  deletingId,
}: {
  items: readonly PlanningItem[];
  kind: PlanningKind;
  countById: ReadonlyMap<string, number> | undefined;
  issueAggregationState: IssueAggregationState;
  expandedId: string | null;
  onEdit: (kind: PlanningKind, item: PlanningItem) => void;
  onExpandedIdChange: (id: string | null) => void;
  onRequestDelete: (kind: PlanningKind, item: PlanningItem) => void;
  deletingId?: string;
}) {
  const t = useTranslations("planning");
  const sections = useTranslations("sections");
  const fieldNames = useFieldNameLabels();

  return (
    <div
      data-testid="planning-compact-list"
      className="grid min-w-0 gap-3"
      role="list"
    >
      {items.map((item) => {
        const count = countById?.get(item.id);
        const isDeleting = deletingId === item.id;
        const body = detailBody(kind, item);
        const summary = body ? stripMarkdown(body) : "";
        const isExpanded = expandedId === item.id;
        const panelId = `planning-detail-compact-${item.id}`;

        return (
          <article
            key={item.id}
            data-testid={`planning-compact-item-${item.id}`}
            className="min-w-0 rounded-md border border-border-subtle bg-surface-card p-3"
            role="listitem"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {body ? (
                  <button
                    type="button"
                    onClick={() =>
                      onExpandedIdChange(isExpanded ? null : item.id)
                    }
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    aria-label={
                      isExpanded
                        ? t("collapseDetails", { name: item.name })
                        : t("expandDetails", { name: item.name })
                    }
                    className="group/disclosure flex w-full min-w-0 items-center gap-1.5 rounded text-left font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover/disclosure:text-foreground">
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          "h-3.5 w-3.5 transition-transform motion-reduce:transition-none",
                          isExpanded && "rotate-90",
                        )}
                      />
                    </span>
                    <span className="min-w-0 break-words">{item.name}</span>
                  </button>
                ) : (
                  <span className="block min-w-0 break-words font-medium">
                    {item.name}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  hitTarget="compact"
                  variant="ghost"
                  onClick={() => onEdit(kind, item)}
                  disabled={isDeleting}
                  aria-label={t("editItem", { name: item.name })}
                >
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
                <PlanningDeleteAction
                  itemName={item.name}
                  issueCount={count}
                  state={issueAggregationState}
                  isDeleting={isDeleting}
                  onRequestDelete={() => onRequestDelete(kind, item)}
                />
              </div>
            </div>

            <dl className="mt-3 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">{fieldNames.status}</dt>
              <dd className="min-w-0">
                <PlanningStatusBadge kind={kind} status={item.status} />
              </dd>
              <dt className="text-muted-foreground">{t("dates")}</dt>
              <dd className="min-w-0 break-words text-right tabular-nums text-muted-foreground">
                <PlanningDates kind={kind} item={item} />
              </dd>
              <dt className="text-muted-foreground">{t("issues")}</dt>
              <dd className="text-right tabular-nums">
                <IssueCount count={count} state={issueAggregationState} />
              </dd>
              <dt className="text-muted-foreground">{sections("details")}</dt>
              <dd className="min-w-0 break-words text-right text-muted-foreground">
                {summary || "—"}
              </dd>
            </dl>

            {isExpanded && body && (
              <div
                id={panelId}
                className="mt-3 min-w-0 rounded-md bg-surface-subtle/40 p-2"
              >
                <MarkdownEditor
                  value={body}
                  onChange={NOOP}
                  readOnly
                  ariaLabel={t("itemDetails", { name: item.name })}
                />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function IssueCount({
  count,
  state,
}: {
  count: number | undefined;
  state: IssueAggregationState;
}) {
  const t = useTranslations("planning");
  if (state === "loading") return <span>{t("issuesLoading")}</span>;
  if (state === "unavailable") return <span>{t("issuesUnavailable")}</span>;
  return <span>{count ?? 0}</span>;
}

function PlanningDeleteAction({
  itemName,
  issueCount,
  state,
  isDeleting,
  onRequestDelete,
}: {
  itemName: string;
  issueCount: number | undefined;
  state: IssueAggregationState;
  isDeleting: boolean;
  onRequestDelete: () => void;
}) {
  const t = useTranslations("planning");
  const descriptionId = useId();
  const linkedIssuesKnown = state === "available";
  const hasLinkedIssues = linkedIssuesKnown && (issueCount ?? 0) > 0;
  const reason = !linkedIssuesKnown
    ? state === "loading"
      ? t("deleteUnavailableWhileIssuesLoading")
      : t("deleteUnavailableWhileIssuesError")
    : hasLinkedIssues
      ? t("removeLinkedFirst")
      : undefined;
  const isAriaDisabled = !linkedIssuesKnown;

  return (
    <>
      <Button
        type="button"
        size="sm"
        hitTarget="compact"
        variant="ghost"
        onClick={(event) => {
          if (isAriaDisabled) {
            event.preventDefault();
            return;
          }
          onRequestDelete();
        }}
        disabled={hasLinkedIssues || isDeleting}
        busy={isDeleting}
        aria-disabled={isAriaDisabled ? true : undefined}
        aria-describedby={reason ? descriptionId : undefined}
        title={reason}
        className={isAriaDisabled ? "cursor-not-allowed opacity-50" : undefined}
        aria-label={t("deleteItem", { name: itemName })}
      >
        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
      </Button>
      {reason ? (
        <span id={descriptionId} className="sr-only">
          {reason}
        </span>
      ) : null}
    </>
  );
}

function PlanningCatalogError({
  isFetching,
  onRetry,
}: {
  isFetching: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("planning");
  const common = useTranslations("common");
  const id = useId();
  return (
    <div
      data-testid="planning-catalog-error"
      role="alert"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-md border border-destructive-focus/30 bg-destructive-fill/[0.04] px-3 py-3"
    >
      <div className="min-w-0">
        <h2
          id={`${id}-title`}
          className="text-sm font-medium text-destructive-text"
        >
          {t("catalogLoadErrorTitle")}
        </h2>
        <p
          id={`${id}-description`}
          className="mt-1 text-sm text-muted-foreground"
        >
          {t("catalogLoadErrorDescription")}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        busy={isFetching}
        onClick={onRetry}
        aria-label={common("retry")}
      >
        {common("retry")}
      </Button>
    </div>
  );
}

function PlanningIssueAggregationError({
  isFetching,
  onRetry,
}: {
  isFetching: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("planning");
  const common = useTranslations("common");
  const id = useId();
  return (
    <div
      data-testid="planning-issue-error"
      role="alert"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-md border border-destructive-focus/30 bg-destructive-fill/[0.04] px-3 py-3"
    >
      <div className="min-w-0">
        <h2
          id={`${id}-title`}
          className="text-sm font-medium text-destructive-text"
        >
          {t("issueLoadErrorTitle")}
        </h2>
        <p
          id={`${id}-description`}
          className="mt-1 text-sm text-muted-foreground"
        >
          {t("issueLoadErrorDescription")}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        busy={isFetching}
        onClick={onRetry}
        aria-label={common("retry")}
      >
        {common("retry")}
      </Button>
    </div>
  );
}

function PlanningDates({
  kind,
  item,
}: {
  kind: PlanningKind;
  item: PlanningItem;
}) {
  const t = useTranslations("planning");
  if (kind === "sprints") {
    const sprint = item as Sprint;
    if (!sprint.start_date && !sprint.end_date) return <>—</>;
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <DateDisplay date={sprint.start_date} emptyText="?" />
        <span aria-hidden="true">–</span>
        <DateDisplay date={sprint.end_date} emptyText="?" />
      </span>
    );
  }
  if (kind === "milestones") {
    return <DateDisplay date={(item as Milestone).target_date} emptyText="—" />;
  }
  const release = item as Release;
  if (release.released_at) {
    return (
      <span>
        {t("released")} <DateDisplay date={release.released_at} />
      </span>
    );
  }
  if (release.target_date) {
    return (
      <span>
        {t("target")} <DateDisplay date={release.target_date} />
      </span>
    );
  }
  return <>—</>;
}
