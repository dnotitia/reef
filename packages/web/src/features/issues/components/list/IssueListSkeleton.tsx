import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

const COLUMN_COUNT = 8;

interface IssueListSkeletonProps {
  rows?: number;
}

const COLUMN_KEYS = Array.from({ length: COLUMN_COUNT }, (_, i) => `col-${i}`);

export function IssueListSkeleton({ rows = 8 }: IssueListSkeletonProps) {
  const rowKeys = Array.from({ length: rows }, (_, i) => `skeleton-row-${i}`);
  return (
    <>
      {rowKeys.map((rowKey) => (
        <TableRow key={rowKey} data-testid="skeleton-row">
          {COLUMN_KEYS.map((colKey) => (
            <TableCell key={colKey}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
