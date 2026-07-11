# Project Context for AI Agents

> Root-level, cross-cutting rules for reef. Package-local rules live in
> `packages/core/AGENTS.md`, `packages/web/AGENTS.md`,
> `packages/jira-migrator/AGENTS.md`, and nested `AGENTS.md` files under those
> package trees; the `CLAUDE.md` files only point back to these `AGENTS.md`
> files.

## Rule Placement

- Keep this root file for repo-wide contracts that cross package boundaries:
  security, persistence, issue data model, schema ownership, release gates, and
  workflows that must stay consistent between `core` and `web`.
- Put package defaults in `packages/core/AGENTS.md` or `packages/web/AGENTS.md`.
- Put implementation rules in the nearest subtree `AGENTS.md` so agents editing
  that code see the rule without carrying unrelated context. Examples:
  `packages/core/src/adapters/AGENTS.md`, `packages/core/src/agents/AGENTS.md`,
  `packages/web/src/app/AGENTS.md`, and `packages/web/tests/e2e/AGENTS.md`.
- When a rule outgrows a short contract or becomes a runbook, move the runbook
  to `docs/` and leave a one-line pointer here or in the nearest package file.

## Repo Shape

- Exact dependency and runtime versions live in `package.json`, package manifests,
  and `tsconfig*.json`; do not rely on version guesses from memory.
- This is a pnpm workspace with private packages. Product runtime behavior
  starts in `core` when it touches schemas, adapters, agents, or shared
  contracts, then surfaces through `web`. Operator-run migration behavior for
  Jira lives in `packages/jira-migrator`.
- `core` is framework-agnostic: no Next.js imports, no DOM APIs, and no Node-only
  globals where avoidable.

## Issue Tracking

reef's own development is tracked in an akb vault (`project_prefix=REEF`) that is
internal to Dnotitia; access to it is not a prerequisite for contributing. When
you do edit issues directly in akb, read the target vault's vault-skill first.
Issue lifecycle state is the `reef_issues.status` row value, not document
metadata.

## Core Invariants

- reef-web persists nothing that belongs to a specific user: no database,
  server-side session store, Redis, KMS, or per-user cache.
- The akb session is the `__reef_session` httpOnly cookie; decode it read-only
  per request and forward it to akb as `Authorization: Bearer <pat>`.
- GitHub access for monitored-repo grounding and activity scans is deployment
  managed through `REEF_GITHUB_APP_ID`, `REEF_GITHUB_APP_INSTALLATION_ID`, and
  `REEF_GITHUB_APP_PRIVATE_KEY`, with `REEF_GITHUB_PAT` allowed only as a
  deployment-managed dev/CI fallback; reef-web must not collect, store, or
  forward a browser GitHub PAT.
- LLM configuration is deployment-managed server state. Standalone deployments
  use `OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL`; managed deployments use the
  fail-closed `REEF_LLM_GOVERNANCE_MODE=platform_hard` profile with
  `REEF_LLM_API_KEY`, `REEF_LLM_BASE_URL`, and
  `REEF_PLATFORM_GATEWAY_BASE_URL`. The two managed URLs must match and legacy
  `OPENROUTER_*` variables must be absent. Both profiles use `REEF_LLM_MODEL`;
  never store per-user LLM keys.
- AKB is the user-account authority. Preserve the stable account-denial codes
  `membership_required`, `account_suspended`, and `identity_conflict`; an AKB
  account denial or invalid-session 401 must clear every established Reef auth
  cookie before returning. A resource-level permission denial must not sign the
  user out.
- `core` is the only place where GitHub, akb, and LLM I/O originates — data-plane
  reads/writes **and** auth/session calls (`login`, `getMe`, `getCurrentActor`)
  alike. `web` consumes `core` through thin Route Handlers; the Route Handler owns
  only the session/cookie lifecycle (mint/clear the `__reef_session` cookie,
  decode it, translate `ReefError` to PM-facing language), never an inline `fetch`
  or an inline akb wire schema.

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

- Issue field display is a cross-package contract: core owns pure metadata,
  while web owns Tailwind classes and field leaf components.
- Core-side field metadata rules live in
  `packages/core/src/schemas/issues/AGENTS.md`.
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
- Standard gates are `pnpm biome check .`, `pnpm -r run typecheck`, and
  `pnpm -r run test`; package-specific details live in the package `AGENTS.md`.
- The web E2E suite (`pnpm --filter @reef/web run test:e2e`) is a required CI
  check (`Playwright E2E`); run the full suite before opening or updating a PR,
  not just the focused spec for the path you changed. A change to shared
  fixtures or the vault-skill version can break a sibling hermetic spec you
  never opened, and that only surfaces in the sharded CI run otherwise.
- Release, migration, Docker, changelog, and deployment rules live in
  `docs/release-policy.md` and `docs/migration-policy.md`. Release-impacting
  changes update `CHANGELOG.md` under `Unreleased`.
- Streaming changes must preserve `/api/agents/runs` SSE delivery; nginx/K8s
  proxy buffering must remain disabled for streaming routes.
