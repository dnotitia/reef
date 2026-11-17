import type { IssueScope } from "@/features/issues/lib/viewMode";

export type BoardQueryState =
  | "loading"
  | "initial-error"
  | "updating"
  | "refreshing"
  | "refresh-error"
  | "no-match"
  | "empty-active"
  | "empty-backlog"
  | "ready";

export function getBoardQueryState({
  hasData,
  isError,
  isFetching,
  isPlaceholderData,
  inputPending,
  visibleCount,
  hasActiveFilters,
  scope,
}: {
  hasData: boolean;
  isError: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
  inputPending: boolean;
  visibleCount: number;
  hasActiveFilters: boolean;
  scope: IssueScope;
}): BoardQueryState {
  if (!hasData) return isError ? "initial-error" : "loading";
  if (isPlaceholderData || inputPending) return "updating";
  if (
    scope === "backlog" &&
    !isError &&
    visibleCount === 0 &&
    !hasActiveFilters
  ) {
    return "empty-backlog";
  }
  if (isError) return "refresh-error";
  if (isFetching) return "refreshing";
  if (visibleCount > 0) return "ready";
  if (hasActiveFilters) return "no-match";
  return scope === "active" ? "empty-active" : "empty-backlog";
}
