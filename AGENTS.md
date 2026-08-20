# Project Context for AI Agents

> Root-level, cross-cutting rules for reef. Package-local rules live in
> `packages/core/AGENTS.md`, `packages/web/AGENTS.md`,
> `packages/jira-migrator/AGENTS.md`, `packages/orchestration/runtime/AGENTS.md`,
> `packages/orchestration/controller/AGENTS.md`,
> `packages/orchestration/providers/reef/AGENTS.md`,
> `packages/orchestration/providers/codex/AGENTS.md`, and
> `packages/orchestration/providers/github/AGENTS.md`,
> nested `AGENTS.md` files under those package trees; the `CLAUDE.md` files only
> point back to these `AGENTS.md` files.

## Rule Placement

- Keep this root file for repo-wide contracts that cross package boundaries:
  security, persistence, issue data model, schema ownership, release gates, and
  workflows that must stay consistent across packages.
- Put package defaults in the matching workspace package's `AGENTS.md`.
- Put implementation rules in the nearest subtree `AGENTS.md` so agents editing
  that code see the rule without carrying unrelated context. Examples:
  `packages/core/src/adapters/AGENTS.md`, `packages/web/src/app/AGENTS.md`,
  `packages/web/src/server/AGENTS.md`, and `packages/web/tests/e2e/AGENTS.md`.
- When a rule outgrows a short contract or becomes a runbook, move the runbook
  to `docs/` and leave a one-line pointer here or in the nearest package file.

## Repo Shape

- Exact dependency and runtime versions live in `package.json`, package manifests,
  and `tsconfig*.json`; do not rely on version guesses from memory.
- This is a pnpm workspace with private packages. Product runtime behavior
  starts in `core` for schemas, models, AKB access, and shared contracts, then
  the server-only application and provider adapters in `web` own GitHub, LLM,
  and agent execution before the result surfaces through the UI. Operator-run
  migration behavior for
  Jira lives in `packages/jira-migrator`; the provider-neutral one-run
  execution core and process signal seam live in `packages/orchestration/runtime`, while
  callers own scheduling and delivery orchestration. Concrete orchestration
  providers, including the private GitHub SCM adapter, own only the backend I/O
  granted by their provider contract.
- `core` is framework-agnostic: no Next.js imports, no DOM APIs, and no Node-only
  globals where avoidable.

## Issue Tracking

reef's own development is tracked in an akb vault (`project_prefix=REEF`) that is
internal to Dnotitia; access to it is not a prerequisite for contributing. When
you do edit issues directly in akb, read the target vault's vault-skill first.
Issue lifecycle state is the `reef_issues.status` row value, not document
metadata.

## Core Invariants

- The current/default reef-web profile persists nothing that belongs to a
  specific user: no database, server-side session store, Redis, KMS, or
  per-user cache. Its only auth carrier is the AKB-issued JWT in the
  `__reef_session` httpOnly cookie; decode it read-only per request and forward
  it to AKB as `Authorization: Bearer <akb-jwt>`.
- The explicitly enabled auth-v2 profile is the single documented exception:
  its server-only OIDC credential custody uses encrypted Redis records and the
  browser receives only an opaque `__reef_auth_v2` handle. This exception is
  active only for auth-v2 Route Handlers after the versioned AKB contract has
  passed readiness and contract tests; it never changes the current/default
  stateless profile or makes the v1 cookie/API dispatch ambiguous.
- GitHub access for monitored-repo grounding and activity scans is deployment
  managed through `REEF_GITHUB_APP_ID`, `REEF_GITHUB_APP_INSTALLATION_ID`, and
  `REEF_GITHUB_APP_PRIVATE_KEY`, with `REEF_GITHUB_PAT` allowed only as a
  deployment-managed dev/CI fallback; reef-web must not collect, store, or
  forward a browser GitHub PAT.
- LLM configuration is deployment-managed server state through the single
  provider-neutral `REEF_LLM_API_KEY`, `REEF_LLM_BASE_URL`, and
  `REEF_LLM_MODEL` contract. Set all three to enable AI or none to disable it;
  partial configuration fails closed. The URL may target OpenRouter or an
  akb-platform gateway, but Reef does not infer a provider or deployment mode.
  Never store per-user LLM keys.
- AKB is the user-account authority. Preserve the stable account-denial codes
  `membership_required`, `account_suspended`, and `identity_conflict`; an AKB
  account denial or invalid-session 401 must clear every established Reef auth
  cookie before returning. A resource-level permission denial must not sign the
  user out.
- `core` is the only place where Reef product AKB I/O and AKB auth/session calls
  (`login`, `getMe`, `getCurrentActor`, and the explicit auth-v2 account
  validation boundary) originate. The server-only `web`
  application owns monitored-repository GitHub I/O, deployment-managed LLM I/O,
  and agent execution; it consumes core's public schemas, errors, models, and
  AKB adapter. Separate orchestration provider packages own only provider I/O
  explicitly granted by their provider-neutral contracts, such as SCM Git
  transport and GitHub pull-request delivery. Route Handlers remain thin: they
  own v1 session/cookie lifecycle (set/clear the `__reef_session` cookie,
  decode it) or the separately named auth-v2 opaque-handle lifecycle, and
  translate `ReefError` to PM-facing language. Route Handlers never contain an
  inline `fetch` or an inline AKB wire schema.

## TypeScript And Boundaries

- TypeScript strict mode is mandatory. Avoid `any`; justify any `@ts-ignore`.
- Zod schemas in `packages/core/src/schemas/` are the single source of truth for data that
  crosses boundaries. Import inferred types instead of redefining them in `web`.
- Wire fields from akb documents, `reef_issues` rows, and GitHub payloads stay
  `snake_case`; TypeScript variables, function names, and React props stay
  camelCase.
- Error classes extend `ReefError` in `packages/core/src/errors/index.ts`; Route Handlers
  translate them to PM-facing language and HTTP status.
- Wrap async server-side GitHub, akb, and LLM boundaries in OpenTelemetry spans.
  Browser IndexedDB access is not traced.

## Logging And Observability

- Backend logging is split by package: `web` owns pino stdout logging and
  request access lines, while `core` owns framework-agnostic spans and reusable
  backend measurements.
- In `web` server code, log through the shared `logger` from
  `@/lib/logging/logger`; do not use `console.*` for request, API, or Route
  Handler diagnostics.
- `/api/*` request logging happens once in `proxy.ts`. Route Handlers may log
  failures or domain events, but must not duplicate inbound request lines.
- Server-side GitHub, akb, and LLM calls should be wrapped in OpenTelemetry
  spans. Use stable operational fields such as route, vault, repo, upstream
  status, duration, and counts.
- Do not put credentials, raw cookies, PATs, LLM headers, prompt text,
  upstream-controlled response bodies, or full request/response objects in logs
  or span attributes.
- In `core`, emit reusable backend measurements through the existing
  observability helper rather than importing the web logger or reading logging
  environment variables.

## Issue Data Model

- A reef issue is an akb task document plus a `reef_issues` row linked by
  `document_uri`. The document carries the plain-markdown body and akb-native
  fields; the row is the queryable projection for board/list fields.
- The akb document title is the uppercase reef id (`REEF-001`). There are no
  per-issue markdown filenames and no fenced YAML frontmatter.
- Issue ids use `{project_prefix}-XXX`; dates are ISO 8601 except for display;
  automated changes record their trigger in `reef_issues.meta.source`.
- Issue schema and field-registry rules live in
  `packages/core/src/schemas/issues/AGENTS.md`.

## Field Display Rules

- Issue and planning field display are cross-package contracts: core owns pure
  metadata, while web owns Tailwind classes and field leaf components.
- Core-side rules live in `packages/core/src/schemas/issues/AGENTS.md` and
  `packages/core/src/schemas/planning/AGENTS.md`.
- Web-side field leaf rules live in
  `packages/web/src/components/fields/AGENTS.md`.

## Security And Persistence

- Do not commit API keys or secrets; `.env.example` is only a template.
- External calls use HTTPS, and the deployment GitHub App or server PAT
  permissions should stay least-privilege for monitored-repo reads.
- Keep credentials in headers or the httpOnly cookie, never URL query strings.
- Do not include sensitive metadata such as tokens, user ids, or server internals
  in LLM prompts.
- Managed-repo writes through akb are last-write-wins. Routine issue metadata
  edits are SQL row updates; body edits go to the akb document. A `ConflictError`
  is exceptional and should be surfaced as a retryable PM-facing save conflict.

## Workflow

- Co-locate unit tests beside their targets. Issue fixtures are plain objects
  validated against `IssueMetadataSchema` or derived schemas.
- During development, run the nearest package's relevant lint, typecheck, and
  tests so deterministic failures stay in the implementation feedback loop.
  Before opening or updating a PR, run the canonical non-E2E gate
  (`pnpm run check`), which runs lint before typecheck, tests, and the release
  policy check. Package-specific details live in the package `AGENTS.md`.
- The web E2E suite is a required CI check (`Playwright E2E`); run the canonical
  isolated full suite (`pnpm --filter @reef/web run test:e2e:sharded`) after the
  non-E2E gate and before opening or updating a PR, not just the focused spec
  for the path you changed.
  Use `pnpm --filter @reef/web run test:e2e` only for focused, single-server
  local debugging. A change to shared fixtures or the vault-skill version can
  break a sibling hermetic spec you never opened, and that only surfaces in the
  sharded CI run otherwise.
- Release and changelog rules live in `docs/release-policy.md`; storage and AKB
  evolution rules live in `docs/migration-policy.md`; Docker and deployment
  rules live in `docs/deployment.md`. Release-impacting changes update
  `CHANGELOG.md` under `Unreleased`.
- Streaming changes must preserve `/api/agents/runs` SSE delivery; nginx/K8s
  proxy buffering must remain disabled for streaming routes.
