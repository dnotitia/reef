import {
  type ThemePreference,
  getTheme,
  setTheme as persistTheme,
} from "@/lib/storage/config";
import { create } from "zustand";
import { applyTheme } from "../lib/theme";

interface ThemeState {
  /** Current preference. `null` until the initial Dexie read resolves. */
  theme: ThemePreference | null;
  /** True once the first hydrate has resolved (success or default). */
  hydrated: boolean;
  /** In-flight guard so concurrent hydrate() calls (StrictMode, multiple
   *  shells) don't double-read or race. */
  hydrating: boolean;
  /** Read the persisted preference once and apply it. Idempotent. */
  hydrate: () => Promise<void>;
  /** Set, apply to the DOM, and persist the preference. */
  setTheme: (next: ThemePreference) => Promise<void>;
}

/**
 * The single canonical source for the theme *selection cursor*.
 *
 * The actual theme is already single-source (Dexie `config` + the `.dark`
 * class + the `localStorage` no-flash mirror), but before REEF-095 the cursor
 * lived in a per-instance `useState` inside `useTheme`, so two controls (Settings
 * Appearance and the account-menu toggle) could disagree on which option looked
 * selected even though the applied theme matched. Promoting the cursor into one
 * Zustand store means every control subscribes to the same value and stays in
 * sync. Dexie remains the persistence canonical source; this store is the shared
 * in-memory reflection of it.
 */
export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: null,
  hydrated: false,
  hydrating: false,
  hydrate: async () => {
    if (get().hydrated || get().hydrating) return;
    set({ hydrating: true });
    try {
      const stored = await getTheme();
      // The controls are usable while this async read is in flight, so a user
      // can pick a theme before it resolves. Their choice is authoritative and
      // already persisted by setTheme — applying the stale stored value here
      // would visibly revert their quick switch. just adopt the stored value if
      // nothing was selected during hydration (`theme` is still its initial
      // null).
      if (get().theme === null) {
        applyTheme(stored);
        set({ theme: stored });
      }
      set({ hydrated: true, hydrating: false });
    } catch {
      // Dexie unavailable (Safari private mode, or a test env without
      // fake-indexeddb). Leave `theme` null and `hydrated` false so a later
      // setTheme still writes through; clear the in-flight guard so a retry
      // can run.
      set({ hydrating: false });
    }
  },
  setTheme: async (next) => {
    set({ theme: next });
    applyTheme(next);
    await persistTheme(next);
  },
}));
