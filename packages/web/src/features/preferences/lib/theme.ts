import type { ThemePreference } from "@/lib/storage/config";

export type { ThemePreference } from "@/lib/storage/config";

export const THEME_STORAGE_KEY = "reef.theme";

export function resolveTheme(
  pref: ThemePreference,
  matchMedia: (query: string) => { matches: boolean } = (q) =>
    typeof window === "undefined" ? { matches: false } : window.matchMedia(q),
): "light" | "dark" {
  if (pref === "light" || pref === "dark") return pref;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  const mode = resolveTheme(pref);
  document.documentElement.classList.toggle("dark", mode === "dark");
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Safari private mode / locked-down storage — class is already applied
    // so the current session is correct; just next-load flash protection
    // is lost.
  }
}
