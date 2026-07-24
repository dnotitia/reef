import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  clearDefaultIssueViewId,
  getDefaultIssueViewId,
  getFavoriteIssueViewIds,
  setFavoriteIssueViewIds,
} from "@/lib/storage/config";
import type {
  CreateSavedIssueView,
  SavedIssueView,
  UpdateSavedIssueView,
} from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { savedIssueViewsKey } from "../queries/useSavedIssueViews";
import {
  type SavedIssueViewPreferences,
  savedIssueViewPreferencesKey,
} from "../useSavedIssueViewPreferences";

async function parseView(response: Response): Promise<SavedIssueView> {
  if (!response.ok) {
    await throwHttpError(
      response,
      `Saved view request failed: ${response.status}`,
    );
  }
  return ((await response.json()) as { view: SavedIssueView }).view;
}

export function useCreateSavedIssueView(vault: string) {
  const queryClient = useQueryClient();
  return useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: savedIssueViewsKey(vault),
        exact: true,
      });
    },
    mutationFn: async (view: CreateSavedIssueView) =>
      parseView(
        await apiFetch(`/api/views?vault=${encodeURIComponent(vault)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(view),
        }),
      ),
    onSuccess: (view) => {
      queryClient.setQueryData<SavedIssueView[]>(
        savedIssueViewsKey(vault),
        (current) =>
          [
            ...(current ?? []).filter((item) => item.id !== view.id),
            view,
          ].toSorted((a, b) => a.name_key.localeCompare(b.name_key)),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: savedIssueViewsKey(vault),
        exact: true,
      });
    },
  });
}

export function useUpdateSavedIssueView(vault: string) {
  const queryClient = useQueryClient();
  return useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: savedIssueViewsKey(vault),
        exact: true,
      });
    },
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: UpdateSavedIssueView;
    }) =>
      parseView(
        await apiFetch(
          `/api/views/${encodeURIComponent(id)}?vault=${encodeURIComponent(vault)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          },
        ),
      ),
    onSuccess: (view) => {
      queryClient.setQueryData<SavedIssueView[]>(
        savedIssueViewsKey(vault),
        (current) =>
          (current ?? [])
            .map((item) => (item.id === view.id ? view : item))
            .toSorted((a, b) => a.name_key.localeCompare(b.name_key)),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: savedIssueViewsKey(vault),
        exact: true,
      });
    },
  });
}

export function useDeleteSavedIssueView(vault: string) {
  const queryClient = useQueryClient();
  return useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: savedIssueViewsKey(vault),
        exact: true,
      });
    },
    mutationFn: async (id: string) => {
      const response = await apiFetch(
        `/api/views/${encodeURIComponent(id)}?vault=${encodeURIComponent(vault)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          `Failed to delete saved view: ${response.status}`,
        );
      }
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<SavedIssueView[]>(
        savedIssueViewsKey(vault),
        (current) => (current ?? []).filter((item) => item.id !== id),
      );
      // The server deletion is already complete. Reconcile the browser-only
      // pointer without turning a local IndexedDB failure into a failed
      // mutation or leaving the successfully deleted row in query cache.
      void getDefaultIssueViewId(vault)
        .then(async (defaultId) => {
          if (defaultId === id) await clearDefaultIssueViewId(vault);
        })
        .catch(() => undefined);
      void getFavoriteIssueViewIds(vault)
        .then(async (favoriteIds) => {
          const next = favoriteIds.filter((favoriteId) => favoriteId !== id);
          if (next.length !== favoriteIds.length) {
            await setFavoriteIssueViewIds(vault, next);
          }
          queryClient.setQueryData<SavedIssueViewPreferences>(
            savedIssueViewPreferencesKey(vault),
            (current) => ({
              defaultId:
                current?.defaultId === id ? undefined : current?.defaultId,
              favoriteIds: (current?.favoriteIds ?? next).filter(
                (favoriteId) => favoriteId !== id,
              ),
            }),
          );
        })
        .catch(() => undefined);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: savedIssueViewsKey(vault),
        exact: true,
      });
    },
  });
}
