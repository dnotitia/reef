import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  ISSUE_LIST_DEFAULT_COLUMNS,
  type IssueListColumnKey,
} from "@/features/issues/components/shared/issueTableContract";

interface IssueListSkeletonProps {
  rows?: number;
  columns?: readonly IssueListColumnKey[];
}

export function IssueListSkeleton({
  rows = 8,
  columns = ISSUE_LIST_DEFAULT_COLUMNS,
}: IssueListSkeletonProps) {
  const rowKeys = Array.from({ length: rows }, (_, i) => `skeleton-row-${i}`);
  return (
    <>
      {rowKeys.map((rowKey) => (
        <TableRow key={rowKey} className="h-10" data-testid="skeleton-row">
          {columns.map((column) => (
            <TableCell
              key={column}
              className="h-10 min-w-0 px-3 py-0"
              data-column-key={column}
            >
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
