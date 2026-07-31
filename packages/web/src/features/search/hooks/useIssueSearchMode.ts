"use client";

import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import type { IssueQueryParams } from "@/features/issues/lib/buildIssueQuery";
import { indexIssuesById } from "@/features/issues/lib/dependencyUtils";
import { isActive, searchIssues } from "@/features/issues/lib/issueListUtils";
import { useMemo, useState } from "react";
import { useExactIssue } from "./useExactIssue";
import { useIssueContentSearch } from "./useIssueContentSearch";

const RECENT_LIMIT = 8;
const SEARCH_LIMIT = 20;
const CONTENT_INITIAL_LIMIT = 10;
const CONTENT_LIMIT_STEP = 10;
const CONTENT_MAX_LIMIT = 50;
const CANONICAL_ID = /^[a-z][a-z0-9_]*-\d{3,}$/i;

interface IssueSearchModeOptions {
  query: string;
  debouncedQuery: string;
  /**
   * Empty while command mode is active. Every server hook below uses this
   * exact gate, so command filtering cannot issue metadata, exact-id,
   * relation, or content-search requests.
   */
  vault: string;
}

/**
 * Owns the existing global-search request and ranking pipeline independently
 * from the palette's command page stack. Request keys, debounce inputs, caps,
 * stale guards, exact-id promotion, dedupe, and quiet content degradation stay
 * unchanged while the dialog swaps between search and command rendering.
 */
export function useIssueSearchMode({
  query,
  debouncedQuery,
  vault,
}: IssueSearchModeOptions) {
  const [contentExpansion, setContentExpansion] = useState({
    query: "",
    limit: CONTENT_INITIAL_LIMIT,
  });
  const liveTrimmed = query.trim();
  const debouncedTrimmed = debouncedQuery.trim();
  const isSearching = liveTrimmed.length > 0;
  const debouncePending = liveTrimmed !== debouncedTrimmed;
  const contentLimit =
    contentExpansion.query === debouncedTrimmed
      ? contentExpansion.limit
      : CONTENT_INITIAL_LIMIT;

  const listQuery: IssueQueryParams = debouncedTrimmed
    ? { q: debouncedTrimmed, limit: String(SEARCH_LIMIT) }
    : { limit: String(RECENT_LIMIT) };
  const {
    data: issues,
    isError,
    isLoading,
    isFetching,
    isPlaceholderData,
  } = useIssueList(vault, listQuery);

  const exactId = CANONICAL_ID.test(debouncedTrimmed)
    ? debouncedTrimmed.toUpperCase()
    : "";
  const pageSettled = !isLoading && !isFetching && !isPlaceholderData;
  const exactOnPage = (issues ?? []).some(
    (issue) => issue.id.toUpperCase() === exactId,
  );
  const probeId = exactId && pageSettled && !exactOnPage ? exactId : "";
  const { data: probedIssue, isFetching: probeFetching } = useExactIssue(
    probeId,
    probeId ? vault : "",
  );
  const exactIdPending =
    exactId !== "" && (!pageSettled || (probeId !== "" && probeFetching));
  const resultsAreCurrent =
    !debouncePending && !isPlaceholderData && !exactIdPending;

  const { data: relations } = useIssueRelations(vault);
  const blockedIndex = useMemo(
    () => indexIssuesById(relations ?? issues ?? []),
    [issues, relations],
  );

  const pool = issues ?? [];
  const withExact =
    probedIssue && !pool.some((issue) => issue.id === probedIssue.id)
      ? [probedIssue, ...pool]
      : pool;
  const matched = searchIssues(withExact.filter(isActive), query);
  const needle = liveTrimmed.toLowerCase();
  const idRank = (id: string): number =>
    id === needle ? 0 : id.includes(needle) ? 1 : 2;
  const results = needle
    ? [...matched]
        .sort((left, right) => {
          return idRank(left.id.toLowerCase()) - idRank(right.id.toLowerCase());
        })
        .slice(0, SEARCH_LIMIT)
    : matched.slice(0, RECENT_LIMIT);

  const contentQuery = useIssueContentSearch(
    debouncedTrimmed,
    vault,
    contentLimit,
  );
  const contentQueryIsCurrent =
    resultsAreCurrent &&
    contentQuery.data?.query === liveTrimmed &&
    [...liveTrimmed].length >= 2;
  const metadataIds = new Set(
    isError ? [] : results.map((result) => result.id),
  );
  const contentResults =
    contentQueryIsCurrent && !contentQuery.isError
      ? (contentQuery.data?.results ?? []).filter(
          (result) => !metadataIds.has(result.reef_id),
        )
      : [];
  const contentInFlight =
    [...debouncedTrimmed].length >= 2 && contentQuery.isFetching;
  const canLoadMore =
    contentQueryIsCurrent &&
    contentQuery.data?.has_more === true &&
    contentLimit < CONTENT_MAX_LIMIT;
  const searchBusy = (isSearching && !resultsAreCurrent) || contentInFlight;

  return {
    blockedIndex,
    canLoadMore,
    contentInFlight,
    contentLimit,
    contentQueryIsCurrent,
    contentResults,
    debouncePending,
    debouncedTrimmed,
    exactIdPending,
    isError,
    isFetching,
    isLoading,
    isSearching,
    liveTrimmed,
    loadMore: () =>
      setContentExpansion({
        query: debouncedTrimmed,
        limit: Math.min(contentLimit + CONTENT_LIMIT_STEP, CONTENT_MAX_LIMIT),
      }),
    results,
    resultsAreCurrent,
    searchBusy,
  };
}
