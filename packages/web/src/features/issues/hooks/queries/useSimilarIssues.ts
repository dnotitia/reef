"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { useDebouncedQuery } from "@/lib/useDebouncedQuery";
import type { SimilarIssue } from "@reef/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export const SIMILAR_ISSUES_DEBOUNCE_MS = 600;
const SIMILAR_ISSUES_LIMIT = 5;
const MIN_SIMILAR_ISSUE_QUERY_LENGTH = 3;

export function useSimilarIssues({
  title,
  vault,
}: {
  title: string;
  vault: string;
}) {
  const query = useDebouncedQuery(SIMILAR_ISSUES_DEBOUNCE_MS, title.trim());

  useEffect(() => {
    query.onChange(title);
  }, [query.onChange, title]);

  const trimmed = query.debounced.trim();
  const result = useQuery({
    queryKey: ["issues", "similar", vault, trimmed] as const,
    queryFn: async (): Promise<SimilarIssue[]> => {
      const params = new URLSearchParams({
        vault,
        q: trimmed,
        limit: String(SIMILAR_ISSUES_LIMIT),
      });
      const res = await apiFetch(`/api/issues/similar?${params.toString()}`);
      if (!res.ok) {
        await throwHttpError(res, `Similar issue search failed: ${res.status}`);
      }
      const body = (await res.json()) as { issues: SimilarIssue[] };
      return body.issues;
    },
    enabled: !!vault && trimmed.length >= MIN_SIMILAR_ISSUE_QUERY_LENGTH,
    retry: false,
    staleTime: 60_000,
  });

  return {
    ...result,
    issues: result.data ?? [],
    settledTitle: trimmed,
    isSettling: query.raw.trim() !== trimmed,
  };
}
