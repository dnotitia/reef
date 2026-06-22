import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { COLUMN_LABELS } from "@/features/issues/components/list/issueListColumns";

// Derive the placeholder column count from the real header labels (REEF-258).
// IssueListTable renders one `<TableHead>` per COLUMN_LABELS entry; the skeleton
// should emit the same number of `<TableCell>`s or the auto-layout table re-flows
// its column widths when the real rows hydrate in (a horizontal CLS jump). A
// hard-coded count (was 8 vs the real 13) is exactly that drift.
const COLUMN_COUNT = COLUMN_LABELS.length;

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
