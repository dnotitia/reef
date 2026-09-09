"use client";

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
  BACKLOG_COLUMNS,
  ISSUE_TABLE_COLUMN_WIDTHS,
  issueTableWidth,
} from "@/features/issues/components/shared/issueTableContract";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { useTranslations } from "next-intl";

const SKELETON_ROWS = ["one", "two", "three", "four", "five", "six"];

function columnStyle(column: (typeof BACKLOG_COLUMNS)[number]) {
  return column === "title"
    ? { minWidth: ISSUE_TABLE_COLUMN_WIDTHS.title }
    : { width: ISSUE_TABLE_COLUMN_WIDTHS[column] };
}

function columnClass(column: (typeof BACKLOG_COLUMNS)[number]) {
  return `h-10 min-w-0 px-3 py-0 align-middle${
    column === "title" ? " min-w-[15rem]" : ""
  }`;
}

export function BacklogTableSkeleton() {
  const fieldNames = useFieldNameLabels();
  const t = useTranslations("issues.backlog");
  const labels = {
    id: fieldNames.id,
    type: fieldNames.type,
    title: fieldNames.title,
    status: fieldNames.status,
    priority: fieldNames.priority,
    assignee: fieldNames.assignee,
    updated: fieldNames.updated,
  } as const;

  return (
    <div
      data-testid="backlog-table-skeleton"
      className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain px-6 py-4"
    >
      <Table
        className="table-fixed"
        style={{ minWidth: issueTableWidth(BACKLOG_COLUMNS) }}
      >
        <colgroup>
          {BACKLOG_COLUMNS.map((column) => (
            <col
              key={column}
              data-column-key={column}
              style={columnStyle(column)}
            />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="h-8">
            {BACKLOG_COLUMNS.map((column) => (
              <TableHead
                key={column}
                className="h-8 px-3 py-0"
                style={columnStyle(column)}
                data-column-key={column}
              >
                {column === "rank" || column === "select"
                  ? null
                  : labels[column]}
                {column === "rank" ? (
                  <span className="sr-only">{t("rank")}</span>
                ) : null}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {SKELETON_ROWS.map((row) => (
            <TableRow key={row} className="h-10">
              {BACKLOG_COLUMNS.map((column) => (
                <TableCell
                  key={column}
                  className={columnClass(column)}
                  style={columnStyle(column)}
                  data-column-key={column}
                >
                  <Skeleton aria-hidden="true" className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
