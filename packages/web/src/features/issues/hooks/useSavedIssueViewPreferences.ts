"use client";

import {
  clearDefaultIssueViewId,
  getDefaultIssueViewId,
  getFavoriteIssueViewIds,
  setDefaultIssueViewId,
  setFavoriteIssueViewIds,
} from "@/lib/storage/config";
import type { SavedIssueView } from "@reef/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

export interface SavedIssueViewPreferences {
  defaultId?: string;
  favoriteIds: readonly string[];
}

export const savedIssueViewPreferencesKey = (vault: string) =>
  ["saved-issue-view-preferences", vault] as const;

async function readPreferences(
  vault: string,
): Promise<SavedIssueViewPreferences> {
  const [defaultId, favoriteIds] = await Promise.all([
    getDefaultIssueViewId(vault),
    getFavoriteIssueViewIds(vault),
  ]);
  return { defaultId, favoriteIds };
}

export function useSavedIssueViewPreferences(
  vault: string,
  views: readonly SavedIssueView[] | undefined,
  viewsSettled: boolean,
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: savedIssueViewPreferencesKey(vault),
    queryFn: () => readPreferences(vault),
    enabled: vault.length > 0,
    // Dexie is the source of truth. Never restore this browser-only mirror
    // from the persisted TanStack snapshot, and always refresh on mount so a
    // snapshot produced by an older client cannot override current pointers.
    meta: { persist: false },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const validIds = useMemo(
    () => new Set((views ?? []).map((view) => view.id)),
    [views],
  );

  useEffect(() => {
    if (!vault || !viewsSettled || !query.data) return;
    const nextDefaultId =
      query.data.defaultId && validIds.has(query.data.defaultId)
        ? query.data.defaultId
        : undefined;
    const nextFavoriteIds = query.data.favoriteIds.filter((id) =>
      validIds.has(id),
    );
    const defaultChanged = nextDefaultId !== query.data.defaultId;
    const favoritesChanged =
      nextFavoriteIds.length !== query.data.favoriteIds.length;
    if (!defaultChanged && !favoritesChanged) return;

    void Promise.all([
      defaultChanged
        ? nextDefaultId
          ? setDefaultIssueViewId(vault, nextDefaultId)
          : clearDefaultIssueViewId(vault)
        : Promise.resolve(),
      favoritesChanged
        ? setFavoriteIssueViewIds(vault, nextFavoriteIds)
        : Promise.resolve(),
    ])
      .then(() => {
        queryClient.setQueryData<SavedIssueViewPreferences>(
          savedIssueViewPreferencesKey(vault),
          {
            defaultId: nextDefaultId,
            favoriteIds: nextFavoriteIds,
          },
        );
      })
      .catch(() => undefined);
  }, [query.data, queryClient, validIds, vault, viewsSettled]);

  const setDefault = useMutation({
    mutationFn: async (id: string | undefined) => {
      if (id) await setDefaultIssueViewId(vault, id);
      else await clearDefaultIssueViewId(vault);
      return id;
    },
    onSuccess: (defaultId) => {
      queryClient.setQueryData<SavedIssueViewPreferences>(
        savedIssueViewPreferencesKey(vault),
        (current) => ({
          defaultId,
          favoriteIds: current?.favoriteIds ?? [],
        }),
      );
    },
  });

  const setFavorite = useMutation({
    mutationFn: async ({
      id,
      favorite,
    }: {
      id: string;
      favorite: boolean;
    }) => {
      const current =
        queryClient.getQueryData<SavedIssueViewPreferences>(
          savedIssueViewPreferencesKey(vault),
        ) ?? (await readPreferences(vault));
      const favoriteIds = favorite
        ? [...new Set([...current.favoriteIds, id])]
        : current.favoriteIds.filter((favoriteId) => favoriteId !== id);
      await setFavoriteIssueViewIds(vault, favoriteIds);
      return favoriteIds;
    },
    onSuccess: (favoriteIds) => {
      queryClient.setQueryData<SavedIssueViewPreferences>(
        savedIssueViewPreferencesKey(vault),
        (current) => ({
          defaultId: current?.defaultId,
          favoriteIds,
        }),
      );
    },
  });

  return {
    defaultId: query.data?.defaultId,
    favoriteIds: query.data?.favoriteIds ?? [],
    // A failed IndexedDB read is settled: shared views remain usable with
    // empty personal preferences instead of trapping the page in a skeleton.
    isLoading: vault.length > 0 && query.isPending,
    setDefault: (id: string | undefined) => setDefault.mutateAsync(id),
    setFavorite: (id: string, favorite: boolean) =>
      setFavorite.mutateAsync({ id, favorite }),
    isSettingDefault: setDefault.isPending,
    isSettingFavorite: setFavorite.isPending,
  };
}
