"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { type UserSearchResult, UserSearchResultSchema } from "@reef/core";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const DirectoryResponseSchema = z.object({
  users: z.array(UserSearchResultSchema),
});

/**
 * Searches the GLOBAL akb user directory for the add-member picker (REEF-179).
 * The `vault` scopes the server-side admin check (the route just lets an
 * admin/owner of that workspace search the directory) and keys the cache.
 * Debounce is the caller's job (`useDebouncedQuery`); an empty query is allowed
 * — akb returns the first page of users so the picker lists candidates before
 * the admin types.
 */
export function useDirectorySearch(
  query: string,
  vault: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["user-directory", vault, query] as const,
    queryFn: async (): Promise<UserSearchResult[]> => {
      const params = new URLSearchParams({ vault });
      if (query.trim()) params.set("q", query.trim());
      const res = await apiFetch(`/api/users/search?${params.toString()}`);
      if (!res.ok) {
        await throwHttpError(res, `Failed to search users: ${res.status}`);
      }
      const data = (await res.json()) as unknown;
      return DirectoryResponseSchema.parse(data).users;
    },
    enabled: enabled && !!vault,
    staleTime: 60 * 1000,
    retry: false,
  });
}
