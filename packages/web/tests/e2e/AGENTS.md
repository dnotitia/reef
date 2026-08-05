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
- The source-free behavior artifact is an additional boundary over this
  harness, not a replacement for the canonical hermetic suite or
  `test:e2e:sharded`. Keep the reviewed behavior in the shared modules under
  `behaviors/`; the hermetic specs and artifact adapter must call those same
  functions.
- `behavior-input.json` may contain only behavior selection, the contract
  clause, web/fixture origins, workspace and reset bindings, credential
  environment variable names, and evidence requirements. Never add selectors,
  UI copy, expected values, or an action-sequence DSL to the input.
- Artifact evidence and transcripts must be redacted, private (`0600`), and
  relative to the output directory. Build the single artifact from a reviewed
  trusted ref and record its SHA-256. The copied artifact must run without a
  repository checkout; external orchestration owns isolation, mounts, runtime
  policy, and candidate binding.
