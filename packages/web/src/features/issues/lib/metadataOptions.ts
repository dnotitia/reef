// Field option/label data now lives in the core field registry (single source
// of truth). Re-exported here for older import support with existing import
// sites; prefer importing from `@reef/core` or `@/components/fields/fieldKit`.
export {
  ISSUE_TYPE_OPTIONS,
  ISSUE_TYPE_LABELS,
  SEVERITY_OPTIONS,
  SEVERITY_LABELS,
  NO_SELECTION,
} from "@reef/core/fields";

export function dateInputValue(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}
