"use client";

import { MarkdownEditor } from "@/components/MarkdownEditor";
import { DateDisplay } from "@/components/fields/DateDisplay";
import { PlanningStatusBadge } from "@/components/fields/PlanningStatusBadge";
import { Button } from "@/components/ui/button";
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
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useMemo } from "react";
import type { PlanningItem, PlanningKind } from "../hooks/usePlanningCatalog";
import { countIssuesByPlanningId, itemsForKind } from "../lib/planningItems";

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
  expandedId,
  onCreate,
  onEdit,
  onExpandedIdChange,
  onRequestDelete,
  deletingId,
}: {
  catalog: PlanningCatalog | undefined;
  kind: PlanningKind;
  issues: readonly IssueListItem[];
  isLoading: boolean;
  expandedId: string | null;
  onCreate: () => void;
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
    () => countIssuesByPlanningId(issues, kind),
    [issues, kind],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-11/12" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-surface-subtle px-6 py-10">
        <p className="text-sm text-muted-foreground">
          {t("emptyKind", { kind: planningKindLabels[kind].toLowerCase() })}
        </p>
        <Button type="button" size="sm" onClick={onCreate} className="gap-1.5">
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          {t("newKind", { kind: planningKindSingular[kind].toLowerCase() })}
        </Button>
      </div>
    );
  }

  return (
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
          const count = countById.get(item.id) ?? 0;
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
                      className="group/disclosure flex w-full min-w-0 items-center gap-1.5 rounded text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      <span className="min-w-0 line-clamp-1">{item.name}</span>
                    </button>
                  ) : (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="w-5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 line-clamp-1">{item.name}</span>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <PlanningStatusBadge kind={kind} status={item.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  <PlanningDates kind={kind} item={item} />
                </TableCell>
                <TableCell className="text-sm tabular-nums">{count}</TableCell>
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
                      variant="ghost"
                      onClick={() => onEdit(kind, item)}
                      aria-label={t("editItem", { name: item.name })}
                    >
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onRequestDelete(kind, item)}
                      disabled={count > 0 || isDeleting}
                      title={count > 0 ? t("removeLinkedFirst") : undefined}
                      aria-label={t("deleteItem", { name: item.name })}
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </Button>
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
      <span className="inline-flex items-center gap-1">
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
