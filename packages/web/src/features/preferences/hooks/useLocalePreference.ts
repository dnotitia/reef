"use client";

import type { Locale } from "@/i18n/locales";
import { useLocale as useActiveLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useLocaleStore } from "../stores/useLocaleStore";

interface UseLocalePreferenceReturn {
  /**
   * The locale to show as selected: the user's persisted choice when present,
   * otherwise the server-detected active locale. Never null — the active locale
   * is always resolved by the provider, so the switcher highlights the right
   * option from first paint without a hydration gap.
   */
  locale: Locale;
  /** Persist a locale choice and re-render the server tree in the new language. */
  setLocale: (next: Locale) => Promise<void>;
}

/**
 * Read and write the UI locale preference (REEF-291).
 *
 * The active locale comes from next-intl's provider (SSR-resolved, so it already
 * reflects the cookie/Accept-Language detection); the persisted choice comes from
 * `useLocaleStore`. Writing persists to Dexie + the cookie + `<html lang>` and
 * then calls `router.refresh()` so the server re-runs `getRequestConfig` with the
 * new cookie — switching message strings and `<html lang>` without a full reload.
 */
export function useLocalePreference(): UseLocalePreferenceReturn {
  const router = useRouter();
  const activeLocale = useActiveLocale() as Locale;
  const storedLocale = useLocaleStore((state) => state.locale);
  const persist = useLocaleStore((state) => state.setLocale);

  const locale = storedLocale ?? activeLocale;

  const setLocale = async (next: Locale): Promise<void> => {
    if (next === locale) return;
    await persist(next);
    // Re-render the server tree: `getRequestConfig` re-reads the just-written
    // cookie and the provider receives the new locale's messages.
    router.refresh();
  };

  return { locale, setLocale };
}
