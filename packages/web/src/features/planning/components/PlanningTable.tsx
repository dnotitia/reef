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
import { cn } from "@/lib/utils";
import type {
  IssueListItem,
  Milestone,
  PlanningCatalog,
  Release,
  Sprint,
} from "@reef/core";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Fragment, useMemo } from "react";
import type { PlanningItem, PlanningKind } from "../hooks/usePlanningCatalog";
import {
  PLANNING_KIND_LABELS,
  PLANNING_KIND_SINGULAR,
  countIssuesByPlanningId,
  itemsForKind,
} from "../lib/planningItems";

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
          No {PLANNING_KIND_LABELS[kind].toLowerCase()} yet.
        </p>
        <Button type="button" size="sm" onClick={onCreate} className="gap-1.5">
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          New {PLANNING_KIND_SINGULAR[kind].toLowerCase()}
        </Button>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead>Issues</TableHead>
          <TableHead>Details</TableHead>
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
                  <div className="flex min-w-0 items-center gap-1.5">
                    {body ? (
                      <button
                        type="button"
                        onClick={() =>
                          onExpandedIdChange(isExpanded ? null : item.id)
                        }
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.name} details`}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            "h-3.5 w-3.5 transition-transform motion-reduce:transition-none",
                            isExpanded && "rotate-90",
                          )}
                        />
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0 line-clamp-1">{item.name}</span>
                  </div>
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
                      aria-label={`Edit ${item.name}`}
                    >
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onRequestDelete(kind, item)}
                      disabled={count > 0 || isDeleting}
                      title={
                        count > 0
                          ? "Remove linked issues before deleting"
                          : undefined
                      }
                      aria-label={`Delete ${item.name}`}
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
                        ariaLabel={`${item.name} details`}
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
        Released <DateDisplay date={release.released_at} />
      </span>
    );
  }
  if (release.target_date) {
    return (
      <span>
        Target <DateDisplay date={release.target_date} />
      </span>
    );
  }
  return <>—</>;
}
