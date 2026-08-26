"use client";

import { AUTH_CHANGED_EVENT } from "@/lib/storage/clientCache";
import {
  filterWorkspaceFavorites,
  getWorkspaceFavorites,
  normalizeWorkspaceFavoriteNames,
  setWorkspaceFavorites,
} from "@/lib/storage/workspaceFavorites";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UseWorkspaceFavoritesOptions {
  enabled?: boolean;
}

export interface WorkspaceFavoritesState {
  favorites: string[];
  hasStorageError: boolean;
  toggleFavorite: (name: string) => Promise<void>;
}

/**
 * Owns the browser-local favorite preference while deriving the visible set
 * from the complete configured useVaults candidate list.
 */
export function useWorkspaceFavorites(
  names: readonly string[],
  { enabled = true }: UseWorkspaceFavoritesOptions = {},
): WorkspaceFavoritesState {
  const availableNames = useMemo(
    () => normalizeWorkspaceFavoriteNames(names),
    [names],
  );
  const [storedFavorites, setStoredFavorites] = useState<string[]>([]);
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
    setHasStorageError(false);

    void getWorkspaceFavorites()
      .then((favorites) => {
        if (cancelled || loadGenerationRef.current !== generation) return;
        const next = enabled
          ? filterWorkspaceFavorites(favorites, availableNames)
          : favorites;
        storedFavoritesRef.current = next;
        setStoredFavorites(next);

        if (enabled && next.length !== favorites.length) {
          void setWorkspaceFavorites(next).catch(() => undefined);
        }
      })
      .catch(() => {
        if (cancelled || loadGenerationRef.current !== generation) return;
        storedFavoritesRef.current = [];
        setStoredFavorites([]);
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
  return {
    favorites,
    hasStorageError,
    toggleFavorite,
  };
}
