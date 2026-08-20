import type { IssueListItem, IssueListResponse } from "@reef/core";
import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import type { IssueQueryParams } from "./buildIssueQuery";
import { normalizeIssueQuery } from "./buildIssueQuery";

export type IssueListInfiniteData = InfiniteData<IssueListResponse, unknown>;

function issueListQueryPrefix(
  vault: string,
): readonly ["issues", "list", string] {
  return ["issues", "list", vault];
}

export function issueListKey(
  vault: string,
  query?: IssueQueryParams,
):
  | readonly ["issues", "list", string]
  | readonly ["issues", "list", string, IssueQueryParams] {
  return query
    ? [...issueListQueryPrefix(vault), normalizeIssueQuery(query)]
    : issueListQueryPrefix(vault);
}

export function issueListInfiniteKey(
  vault: string,
  query: IssueQueryParams,
): readonly ["issues", "list", string, "infinite", IssueQueryParams] {
  return [
    ...issueListQueryPrefix(vault),
    "infinite",
    normalizeIssueQuery(query),
  ];
}

export function isIssueListInfiniteKey(
  queryKey: readonly unknown[],
): queryKey is readonly [
  "issues",
  "list",
  string,
  "infinite",
  IssueQueryParams,
] {
  return (
    queryKey[0] === "issues" &&
    queryKey[1] === "list" &&
    typeof queryKey[2] === "string" &&
    queryKey[3] === "infinite" &&
    isIssueQueryParams(queryKey[4])
  );
}

export function issueListQueryFromKey(
  queryKey: readonly unknown[],
): IssueQueryParams | undefined {
  if (isIssueListInfiniteKey(queryKey)) return queryKey[4];
  if (
    queryKey[0] !== "issues" ||
    queryKey[1] !== "list" ||
    typeof queryKey[2] !== "string" ||
    queryKey.length !== 4 ||
    !isIssueQueryParams(queryKey[3])
  ) {
    return undefined;
  }
  return queryKey[3];
}

export function flattenIssueListPages(
  data: IssueListInfiniteData | undefined,
): IssueListItem[] {
  if (!data) return [];
  const seen = new Set<string>();
  const issues: IssueListItem[] = [];
  for (const page of data.pages) {
    for (const issue of page.issues) {
      if (seen.has(issue.id)) continue;
      seen.add(issue.id);
      issues.push(issue);
    }
  }
  return issues;
}

export function mapIssueListCache(
  queryKey: QueryKey,
  data: unknown,
  mapIssues: (issues: IssueListItem[]) => IssueListItem[],
): unknown {
  if (isIssueListInfiniteKey(queryKey)) {
    if (!isIssueListInfiniteData(data)) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        issues: mapIssues(page.issues),
      })),
    } satisfies IssueListInfiniteData;
  }

  if (
    issueListQueryFromKey(queryKey) !== undefined ||
    isBareIssueListKey(queryKey)
  ) {
    return Array.isArray(data) ? mapIssues(data) : data;
  }
  return data;
}

export function prependIssueToIssueListCache(
  queryKey: QueryKey,
  data: unknown,
  issue: IssueListItem,
): unknown {
  if (isIssueListInfiniteKey(queryKey)) {
    if (!isIssueListInfiniteData(data)) return data;
    if (
      data.pages.some((page) => page.issues.some(({ id }) => id === issue.id))
    ) {
      return data;
    }
    const [firstPage, ...restPages] = data.pages;
    if (!firstPage) return data;
    return {
      ...data,
      pages: [
        { ...firstPage, issues: [issue, ...firstPage.issues] },
        ...restPages,
      ],
    } satisfies IssueListInfiniteData;
  }

  if (
    issueListQueryFromKey(queryKey) !== undefined ||
    isBareIssueListKey(queryKey)
  ) {
    if (!Array.isArray(data)) return data;
    if (data.some((item) => isIssueListItem(item) && item.id === issue.id)) {
      return data;
    }
    return [issue, ...data];
  }
  return data;
}

export function updateIssueListCaches(
  queryClient: QueryClient,
  vault: string,
  update: (issue: IssueListItem) => IssueListItem,
): Array<[QueryKey, unknown]> {
  const previous = queryClient.getQueriesData<unknown>({
    queryKey: issueListQueryPrefix(vault),
  });
  for (const [queryKey, data] of previous) {
    queryClient.setQueryData(
      queryKey,
      mapIssueListCache(queryKey, data, (issues) => issues.map(update)),
    );
  }
  return previous;
}

/**
 * Restore only the issue that belongs to a failed mutation. Restoring an
 * entire list snapshot can erase a sibling row's newer optimistic update when
 * two rows are saved at the same time.
 */
export function restoreIssueListCacheItems(
  queryClient: QueryClient,
  previous: Array<[QueryKey, unknown]>,
  issueId: string,
): void {
  for (const [queryKey, previousData] of previous) {
    const previousIssue = findIssueListCacheItem(
      queryKey,
      previousData,
      issueId,
    );
    if (!previousIssue) continue;

    const currentData = queryClient.getQueryData<unknown>(queryKey);
    queryClient.setQueryData(
      queryKey,
      mapIssueListCache(queryKey, currentData, (issues) =>
        issues.map((issue) => (issue.id === issueId ? previousIssue : issue)),
      ),
    );
  }
}

export function prependIssueToIssueListCaches(
  queryClient: QueryClient,
  vault: string,
  issue: IssueListItem,
): void {
  const caches = queryClient.getQueriesData<unknown>({
    queryKey: issueListQueryPrefix(vault),
  });
  for (const [queryKey, data] of caches) {
    queryClient.setQueryData(
      queryKey,
      prependIssueToIssueListCache(queryKey, data, issue),
    );
  }
}

function isBareIssueListKey(
  queryKey: readonly unknown[],
): queryKey is readonly ["issues", "list", string] {
  return (
    queryKey.length === 3 &&
    queryKey[0] === "issues" &&
    queryKey[1] === "list" &&
    typeof queryKey[2] === "string"
  );
}

function isIssueQueryParams(value: unknown): value is IssueQueryParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (item) =>
      typeof item === "string" ||
      (Array.isArray(item) && item.every((entry) => typeof entry === "string")),
  );
}

function isIssueListItem(value: unknown): value is IssueListItem {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function findIssueListCacheItem(
  queryKey: QueryKey,
  data: unknown,
  issueId: string,
): IssueListItem | undefined {
  if (isIssueListInfiniteKey(queryKey)) {
    if (!isIssueListInfiniteData(data)) return undefined;
    for (const page of data.pages) {
      const issue = page.issues.find((candidate) => candidate.id === issueId);
      if (issue) return issue;
    }
    return undefined;
  }

  if (
    issueListQueryFromKey(queryKey) !== undefined ||
    isBareIssueListKey(queryKey)
  ) {
    if (!Array.isArray(data)) return undefined;
    const issue = data.find(
      (candidate): candidate is IssueListItem =>
        isIssueListItem(candidate) && candidate.id === issueId,
    );
    return issue;
  }
  return undefined;
}

function isIssueListResponse(value: unknown): value is IssueListResponse {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { issues?: unknown }).issues) &&
    (value as { issues: unknown[] }).issues.every(isIssueListItem)
  );
}

export function isIssueListInfiniteData(
  value: unknown,
): value is IssueListInfiniteData {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { pages?: unknown }).pages) &&
    Array.isArray((value as { pageParams?: unknown }).pageParams) &&
    (value as { pages: unknown[] }).pages.every(isIssueListResponse)
  );
}
