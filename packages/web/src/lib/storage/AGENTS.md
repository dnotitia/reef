# `web/src/lib/storage` — Dexie Store Rules

- The only live store is `config`.
- `config` holds active `vault`, theme, locale, `akb_user_id`, activity visit
  and scan timestamps, and per-vault UI preferences such as active scan repo and
  saved issue filters. Locale is mirrored to the `NEXT_LOCALE` cookie for SSR,
  while IndexedDB remains canonical. The store does not hold monitored repos,
  `project_prefix`, or LLM config.
- GitHub access is deployment-managed through the server GitHub App or optional
  server PAT fallback. `__reef_session` is httpOnly and contains a local AKB JWT
  or an opaque SSO handle; browser storage never contains an auth token.
- Store-layout changes require a Dexie version bump and migration closure; see
  `docs/migration-policy.md`.
