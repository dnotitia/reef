"use client";

import type { ThemePreference } from "@/lib/storage/config";
import { useThemeStore } from "../stores/useThemeStore";

interface UseThemeReturn {
  /** Current preference. `null` until the shell's initial Dexie read resolves. */
  theme: ThemePreference | null;
  setTheme: (next: ThemePreference) => Promise<void>;
}

/**
 * Read and write the shared theme preference.
 *
 * A thin façade over `useThemeStore` using granular selectors (vercel
 * `rerender-defer-reads`), so every control — Settings → Appearance and the
 * account-menu toggle — shares one selection cursor and can not drift
 * (REEF-095). The hook has no effects: hydration and the OS `system` listener
 * live in `useThemeSync`, mounted once at the shell.
 */
export function useTheme(): UseThemeReturn {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  return { theme, setTheme };
}
