"use client";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IssueListSkeleton } from "@/features/issues/components/list/IssueListSkeleton";
import {
  ISSUE_LIST_DEFAULT_COLUMNS,
  ISSUE_TABLE_COLUMN_WIDTHS,
  ISSUE_TABLE_TITLE_MIN_WIDTH,
  isIssueTableStickyColumn,
  issueTableColumnOffset,
  issueTableWidth,
} from "@/features/issues/components/shared/issueTableContract";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { useTranslations } from "next-intl";

function columnStyle(column: (typeof ISSUE_LIST_DEFAULT_COLUMNS)[number]) {
  return {
    ...(column === "title"
      ? { minWidth: ISSUE_TABLE_TITLE_MIN_WIDTH }
      : { width: ISSUE_TABLE_COLUMN_WIDTHS[column] }),
    ...(isIssueTableStickyColumn(column)
      ? {
          left: issueTableColumnOffset(ISSUE_LIST_DEFAULT_COLUMNS, column),
          position: "sticky" as const,
        }
      : {}),
  };
}

export function IssueListViewSkeleton() {
  const labels = useFieldNameLabels();
  const t = useTranslations("issues.list");

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        className="min-h-0 h-full min-w-0 overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
        role="region"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The labeled overflow region is the keyboard scrollport.
        tabIndex={0}
        aria-label={t("scrollRegion")}
        data-testid="issue-list-scroll-container"
      >
        <Table
          className="reef-issue-list-table table-fixed"
          style={{ minWidth: issueTableWidth(ISSUE_LIST_DEFAULT_COLUMNS) }}
          containerClassName="overflow-visible"
          data-testid="issues-list-table-skeleton"
        >
          <colgroup>
            {ISSUE_LIST_DEFAULT_COLUMNS.map((column) => (
              <col
                key={column}
                data-column-key={column}
                style={columnStyle(column)}
              />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              {ISSUE_LIST_DEFAULT_COLUMNS.map((column) => (
                <TableHead
                  key={column}
                  className={`h-8 px-3 py-0${
                    isIssueTableStickyColumn(column)
                      ? " sticky z-20 bg-surface-page"
                      : ""
                  }${column === "title" ? " min-w-[15rem]" : ""}`}
                  style={columnStyle(column)}
                  data-column-key={column}
                >
                  {column === "select" ? null : labels[column]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <IssueListSkeleton columns={ISSUE_LIST_DEFAULT_COLUMNS} />
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
