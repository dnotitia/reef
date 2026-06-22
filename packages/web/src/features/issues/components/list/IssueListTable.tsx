"use client";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IssueListRow } from "@/features/issues/components/list/IssueListRow";
import { IssueListSkeleton } from "@/features/issues/components/list/IssueListSkeleton";
import { COLUMN_LABELS } from "@/features/issues/components/list/issueListColumns";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { useResolvedAutoHideWindows } from "@/features/issues/hooks/useResolvedAutoHideWindows";
import { useOpenIssue } from "@/features/issues/hooks/view/useOpenIssue";
import { buildIssueQuery } from "@/features/issues/lib/buildIssueQuery";
import { applyDependencyFilter } from "@/features/issues/lib/dependencyUtils";
import {
  filterIssues,
  searchIssues,
  sortIssues,
} from "@/features/issues/lib/issueListUtils";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { PageBody } from "@/features/ui/components/PageBody";
import { DURATION_BASE, EASE_SIGNATURE } from "@/lib/motionTokens";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useMemo } from "react";

const EMPTY_ISSUES: never[] = [];

interface IssueListTableProps {
  vault: string;
}

/**
 * Table view body for the issues workspace. Self-contained: owns its own
 * data fetch, filter/search/sort projection, and loading/error/empty states.
 * The surrounding chrome (PageHeader, ViewSwitcher, IssueFilterToolbar,
 * vault-empty state) is owned by IssuesWorkspace.
 */
export function IssueListTable({ vault }: IssueListTableProps) {
  // Granular Zustand selectors (does not whole store)
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const openIssue = useOpenIssue();
  // FLIP the rows into place when the sort/filter projection reorders them,
  // instead of swapping content under fixed positions. Honors
  // prefers-reduced-motion by default.
  const [rowsRef] = useAutoAnimate<HTMLTableSectionElement>({
    duration: DURATION_BASE,
    easing: EASE_SIGNATURE,
  });

  // Server-side narrows the transfer (facets + free-text search); the client
  // pipeline still applies due/label/dependency residuals + sort. The
  // whole-vault relation projection backs blocker badges + the dependency
  // filter over the filtered subset.
  const query = useMemo(
    () => buildIssueQuery(filter, searchQuery),
    [filter, searchQuery],
  );
  // isPending (not isLoading) — see useActiveVault for the rationale.
  const {
    data: issues,
    isPending,
    isError,
    refetch,
  } = useIssueList(vault, query);
  const staleWindowDays = useResolvedAutoHideWindows(vault);
  const { data: relations } = useIssueRelations(vault);
  const { data: planningCatalog } = usePlanningCatalog(vault);

  const allIssues = issues ?? EMPTY_ISSUES;
  // Dependency graph: prefer the whole-vault relation projection; fall back to
  // the displayed set until it loads (or in tests without a relations mock).
  const graph = relations ?? allIssues;
  const sorted = useMemo(() => {
    const filtered = filterIssues(allIssues, filter, {
      searchActive: searchQuery.trim().length > 0,
      staleWindowDays,
    });
    const searched = searchIssues(filtered, searchQuery);
    const depFiltered = applyDependencyFilter(
      searched,
      filter.dependencyFilter ?? null,
      graph,
    );
    return sortIssues(depFiltered, filter.sortField, filter.sortOrder);
  }, [allIssues, filter, graph, searchQuery, staleWindowDays]);

  const hasActiveFilters = !!(
    filter.status?.length ||
    filter.issueType?.length ||
    filter.priority?.length ||
    filter.assignee ||
    filter.requester ||
    filter.sprint_id ||
    filter.milestone_id ||
    filter.release_id ||
    filter.severity?.length ||
    filter.due?.length ||
    filter.label ||
    filter.dependencyFilter?.length ||
    searchQuery
  );

  return (
    <PageBody pad="compact">
      {isPending ? (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMN_LABELS.map((col) => (
                <TableHead key={col}>{col}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <IssueListSkeleton />
          </TableBody>
        </Table>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <p className="text-sm text-muted-foreground">
            Failed to load issues.
          </p>
          <button
            type="button"
            className="rounded-md border border-border bg-elevated px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
            onClick={() => refetch()}
          >
            Retry
          </button>
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          {hasActiveFilters ? (
            <>
              <p className="text-sm text-muted-foreground">
                No issues match your filters.
              </p>
              <button
                type="button"
                className="rounded-md border border-border bg-elevated px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
                onClick={() => {
                  useIssueStore.getState().clearFilter();
                }}
              >
                Clear filters
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your workspace is empty. What are you working on?
            </p>
          )}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMN_LABELS.map((col) => (
                <TableHead key={col}>{col}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody ref={rowsRef}>
            {sorted.map((issue) => (
              <IssueListRow
                key={issue.id}
                issue={issue}
                vault={vault}
                allIssues={graph}
                planningCatalog={planningCatalog}
                highlightQuery={searchQuery}
                onClick={openIssue}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </PageBody>
  );
}
