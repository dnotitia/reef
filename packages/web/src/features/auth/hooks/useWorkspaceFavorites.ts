"use client";

import { AUTH_CHANGED_EVENT } from "@/lib/storage/clientCache";
import {
  filterWorkspaceFavorites,
  getConfiguredWorkspaceNames,
  getWorkspaceFavorites,
  normalizeWorkspaceFavoriteNames,
  setWorkspaceFavorites,
  type WorkspaceFavoriteCandidate,
} from "@/lib/storage/workspaceFavorites";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UseWorkspaceFavoritesOptions {
  enabled?: boolean;
}

export interface WorkspaceFavoritesState {
  favorites: string[];
  isLoading: boolean;
  hasStorageError: boolean;
  isFavorite: (name: string) => boolean;
  toggleFavorite: (name: string) => Promise<void>;
}

/**
 * Owns the browser-local favorite preference while deriving the visible set
 * from the complete configured useVaults candidate list.
 */
export function useWorkspaceFavorites(
  candidates: readonly WorkspaceFavoriteCandidate[],
  { enabled = true }: UseWorkspaceFavoritesOptions = {},
): WorkspaceFavoritesState {
  const availableNames = useMemo(
    () => getConfiguredWorkspaceNames(candidates),
    [candidates],
  );
  const [storedFavorites, setStoredFavorites] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasStorageError, setHasStorageError] = useState(false);
  const storedFavoritesRef = useRef<string[]>([]);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    storedFavoritesRef.current = storedFavorites;
  }, [storedFavorites]);

  useEffect(() => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    let cancelled = false;
    setIsLoading(true);
    setHasStorageError(false);

    void getWorkspaceFavorites()
      .then((favorites) => {
        if (cancelled || loadGenerationRef.current !== generation) return;
        const next = enabled
          ? filterWorkspaceFavorites(favorites, availableNames)
          : favorites;
        storedFavoritesRef.current = next;
        setStoredFavorites(next);
        setIsLoading(false);

        if (enabled && next.length !== favorites.length) {
          void setWorkspaceFavorites(next).catch(() => undefined);
        }
      })
      .catch(() => {
        if (cancelled || loadGenerationRef.current !== generation) return;
        storedFavoritesRef.current = [];
        setStoredFavorites([]);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [availableNames, enabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleAuthChanged = () => {
      loadGenerationRef.current += 1;
      storedFavoritesRef.current = [];
      setStoredFavorites([]);
      setHasStorageError(false);
      setIsLoading(false);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
    return () =>
      window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
  }, []);

  const toggleFavorite = useCallback(
    async (name: string) => {
      if (!availableNames.includes(name)) return;
      const before = storedFavoritesRef.current;
      const isCurrentlyFavorite = before.includes(name);
      const next = normalizeWorkspaceFavoriteNames(
        isCurrentlyFavorite
          ? before.filter((favorite) => favorite !== name)
          : [...before, name],
      );
      const generation = loadGenerationRef.current;

      storedFavoritesRef.current = next;
      setStoredFavorites(next);
      setHasStorageError(false);

      try {
        await setWorkspaceFavorites(next);
      } catch {
        if (
          loadGenerationRef.current !== generation ||
          storedFavoritesRef.current !== next
        ) {
          return;
        }
        storedFavoritesRef.current = before;
        setStoredFavorites(before);
        setHasStorageError(true);
      }
    },
    [availableNames],
  );

  const favorites = useMemo(
    () =>
      enabled ? filterWorkspaceFavorites(storedFavorites, availableNames) : [],
    [availableNames, enabled, storedFavorites],
  );
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const isFavorite = useCallback(
    (name: string) => favoriteSet.has(name),
    [favoriteSet],
  );

  return {
    favorites,
    isLoading,
    hasStorageError,
    isFavorite,
    toggleFavorite,
  };
}
