# `web/src/lib/storage` — Dexie Store Rules

- The only live store is `config`.
- `config` holds active `vault`, theme, `akb_user_id`, and per-vault UI
  preferences such as active scan repo and saved issue filters. It does not hold
  monitored repos, `project_prefix`, or LLM config.
- GitHub access is deployment-managed through the server GitHub App or optional
  server PAT fallback. The akb session lives in the `__reef_session` httpOnly
  cookie.
- Store-layout changes require a Dexie version bump and migration closure; see
  `docs/migration-policy.md`.
