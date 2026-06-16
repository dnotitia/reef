# `web/tests/e2e` — Hermetic E2E Rules

- Playwright E2E is hermetic by default: reef-web and its Route Handlers run for
  real, while external services are replaced by the local fixture server under
  `harness/`.
- Do not mock reef's own `/api/*` routes with `page.route` in default E2E unless
  the spec explicitly documents itself as UI-only.
- When adding or changing a routed page, parallel/intercepting route, modal,
  subpage, or contextual dialog, add or update hermetic Playwright coverage for
  the user-visible workflow.
- Exercise reef-web Route Handlers for real; mock only external dependencies in
  `harness/`. If E2E coverage is deliberately deferred, document the reason and
  follow-up issue in the PR.
- Logged-in E2E state should be created through the real login route against the
  fixture AKB backend, not by hand-writing `__reef_session` cookies or Dexie
  `config` rows. Reset fixture data through `/__e2e/reset` before each test.
