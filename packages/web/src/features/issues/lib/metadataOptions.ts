// Field option data lives in the core field registry.
// Re-exported here for older import support with existing import sites; prefer
// importing from `@reef/core` or `@/components/fields/fieldKit`. Human labels are
// locale-resolved through `@/i18n/fieldLabels` (REEF-292), not re-exported here.
export {
  ISSUE_TYPE_OPTIONS,
  SEVERITY_OPTIONS,
  NO_SELECTION,
} from "@reef/core/fields";

export function dateInputValue(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}
