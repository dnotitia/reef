import type { Locale } from "@/i18n/locales";
import { getLocale, setLocale as persistLocale } from "@/lib/storage/config";
import { create } from "zustand";
import { applyLocale } from "../lib/locale";

interface LocaleState {
  /**
   * The persisted locale *choice*. `null` until the initial Dexie read resolves
   * and when the user has not picked one — in the latter case the server
   * detection chain (cookie → Accept-Language → en) governs the active locale,
   * so `useLocalePreference` reads next-intl's active locale as the fallback
   * display value.
   */
  locale: Locale | null;
  /** True once the first hydrate has resolved (a stored value or none). */
  hydrated: boolean;
  /** In-flight guard so concurrent hydrate() calls don't double-read or race. */
  hydrating: boolean;
  /** Read the persisted choice once and reconcile the cookie/lang. Idempotent. */
  hydrate: () => Promise<void>;
  /** Set, apply (lang + cookie), and persist the locale choice. */
  setLocale: (next: Locale) => Promise<void>;
}

/**
 * Canonical store for the persisted UI locale *choice*, mirroring `useThemeStore`
 * (REEF-291 / ADR-0001). IndexedDB is the persistence owner; this is
 * its shared in-memory reflection so every control stays in sync.
 *
 * It tracks the persisted choice; the *active* locale (what the server
 * actually rendered, including a detected-but-unpersisted locale) is owned by
 * next-intl's provider. `useLocalePreference` composes the two: persisted choice
 * if present, else the active detected locale.
 */
export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: null,
  hydrated: false,
  hydrating: false,
  hydrate: async () => {
    if (get().hydrated || get().hydrating) return;
    set({ hydrating: true });
    try {
      const stored = await getLocale();
      // A control may set the locale before this async read resolves; that
      // choice is authoritative and already applied, so adopt the stored
      // value when nothing was selected during hydration. Re-applying restores
      // the `<html lang>` + cookie mirror in case the cookie was cleared/expired
      // — IndexedDB is canonical (ADR-0001).
      if (get().locale === null && stored) {
        applyLocale(stored);
        set({ locale: stored });
      }
      set({ hydrated: true, hydrating: false });
    } catch {
      // Dexie unavailable (Safari private mode, or a test env without
      // fake-indexeddb). Leave `locale` null and `hydrated` false so a later
      // setLocale still writes through; clear the guard so a retry can run.
      set({ hydrating: false });
    }
  },
  setLocale: async (next) => {
    set({ locale: next });
    applyLocale(next);
    await persistLocale(next);
  },
}));
