"use client";

import type { Locale } from "@/i18n/locales";
import { useLocale as useActiveLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLocaleStore } from "../stores/useLocaleStore";

/**
 * Singleton locale side-effects: a one-time hydrate from Dexie and a reconcile
 * of the server-rendered locale against the persisted choice. Call this exactly
 * once, at the consistently-mounted shell — the mirror of `useThemeSync`.
 *
 * The reconcile makes IndexedDB genuinely canonical (ADR-0001): if a persisted
 * choice survived a cleared or expired `NEXT_LOCALE` cookie, the server renders
 * the detected locale, `hydrate()` restores the cookie + `<html lang>`, and this
 * effect refreshes once so the server re-renders message strings in the restored
 * locale. In the common case (cookie present and matching), nothing refreshes.
 */
export function useLocaleSync(): void {
  const router = useRouter();
  const activeLocale = useActiveLocale() as Locale;
  const hydrate = useLocaleStore((state) => state.hydrate);
  const hydrated = useLocaleStore((state) => state.hydrated);
  const storedLocale = useLocaleStore((state) => state.locale);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated || !storedLocale || storedLocale === activeLocale) return;
    // Persisted choice diverged from what the server rendered (cookie was
    // cleared/expired). hydrate() already restored the cookie; refresh once so
    // the server re-renders in the restored locale. After this, active ===
    // stored, so it won't loop.
    router.refresh();
  }, [hydrated, storedLocale, activeLocale, router]);
}
