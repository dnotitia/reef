import type { Locale } from "./locales";
import type { Messages } from "./messages";

/**
 * Type-safe message keys (REEF-293, AC2 "missing-key check"). Registering the
 * en base catalog as `AppConfig["Messages"]` makes `useTranslations` / `t(...)`
 * reject keys absent from the catalog at compile time, so a typo or a
 * not-yet-added key fails `pnpm -r run typecheck` (a CI gate) rather than
 * silently rendering the raw key in the UI. The en catalog is the structural
 * base (see `messages.ts`); ko stays a `DeepPartial` of it.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
