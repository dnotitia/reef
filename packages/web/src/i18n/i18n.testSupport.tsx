import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { Locale } from "./locales";
import { loadMessages } from "./messages";

/**
 * Intl wrapper for tests (REEF-293). Components migrated to `useTranslations`
 * throw "No intl context found" when rendered bare, so unit tests render them
 * inside this provider. It mirrors the production request config — the same
 * `loadMessages` deep-merge (so ko inherits the en fallback, AC3) and UTC time
 * zone — so a unit test sees exactly what the app renders.
 *
 * Default locale is `en`, the base catalog, so existing English assertions keep
 * passing unchanged after a component is migrated; pass `locale="ko"` to assert
 * the translated surface.
 *
 * Named `*.testSupport.tsx` so it is excluded from the production graph (test
 * imports) and from the i18n hardcoded-string guard.
 */
export function IntlTestProvider({
  locale = "en",
  children,
}: {
  locale?: Locale;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={loadMessages(locale)}
      timeZone="UTC"
    >
      {children}
    </NextIntlClientProvider>
  );
}
