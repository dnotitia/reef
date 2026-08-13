# @reef/web

Next.js App Router application package for reef. `@reef/web` renders the product
UI and acts as a mode-aware Backend-for-Frontend over AKB-managed workspaces. It
owns server-only GitHub/LLM adapters and agent application code, while using
`@reef/core` for domain schemas, models, errors, observability, and AKB access.

Local auth persists no user-specific server state: AKB's JWT stays in the
`__reef_session` httpOnly cookie. SSO is the narrow exception: Reef owns OIDC
Authorization Code + PKCE and keeps the encrypted, expiring token set in Redis;
the browser receives only a random opaque httpOnly handle. GitHub and LLM
credentials remain deployment-managed server configuration.

## Responsibilities

- Render the issues workspace, board, list, timeline, planning, activity,
  reports, settings, onboarding, and login views.
- Expose Route Handlers under `src/app/api/*` that validate inputs, extract
  credentials, resolve server application use cases, call `@reef/core` for AKB
  and domain behavior, and translate errors into PM-facing HTTP responses.
- Own deployment-managed GitHub and LLM adapters under `src/server/adapters/`.
- Own chat, enrichment, activity scanning, prompts, and AI SDK tools under
  `src/server/application/agents/`.
- Manage browser-local UI state through Dexie, localStorage, and TanStack Query
  persistence where appropriate.
- Stream chat and agent runs to the client while preserving SSE-compatible
  delivery.
- Build a Next.js standalone output for Docker.

## Local setup

Prerequisites:

- Node.js 24.15+ support floor; the repository execution pin is the exact
  version declared in the root `.node-version` file.
- pnpm 11.10.0
- A reachable AKB backend

reef-web talks to AKB through `AKB_BACKEND_URL`; it does not require AKB to run
in the same repository, process, or host. For local development, one convenient
option is the AKB Docker Compose setup. That option requires Docker Desktop and
a checkout of the [AKB repository](https://github.com/dnotitia/akb). From the
root of your AKB checkout:

```bash
cp config/app.yaml.example config/app.yaml
cp config/secret.yaml.example config/secret.yaml
docker compose up -d
curl http://localhost:8000/livez
```

Create the web environment file from the repo root:

```bash
cp packages/web/.env.example packages/web/.env.local
```

For local development, `packages/web/.env.local` should include:

```bash
REEF_AUTH_MODE=local
AKB_BACKEND_URL=http://localhost:8000
REEF_LLM_API_KEY=
REEF_LLM_BASE_URL=
REEF_LLM_MODEL=
```

Start reef from the repo root:

```bash
pnpm dev
```

Open [http://localhost:7333](http://localhost:7333).

## Environment

All variables in `.env.local` are server-only. Do not add `NEXT_PUBLIC_*`
variables for secrets.

| Variable | Purpose |
| --- | --- |
| `REEF_AUTH_MODE` | Required explicit profile: `local` for AKB-issued JWT cookies or `sso` for Reef-owned OIDC and opaque sessions. |
| `AKB_BACKEND_URL` | Base URL for the AKB backend. Local dev usually uses `http://localhost:8000`. |
| `REEF_KEYCLOAK_ISSUER` | Exact Keycloak realm issuer in SSO mode. HTTPS outside loopback development. |
| `REEF_KEYCLOAK_TRANSPORT_URL` | Production-required in-cluster Keycloak realm URL for token/JWKS/revocation and readiness calls; exact realm path must match the issuer. |
| `REEF_KEYCLOAK_CLIENT_ID` | Reef's dedicated Keycloak client id in SSO mode. |
| `REEF_AKB_API_AUDIENCE` | Required AKB API audience in every accepted Keycloak access token. |
| `REEF_PUBLIC_ORIGIN` | Reef's bare public origin; required in SSO mode for callback/logout URLs. |
| `REEF_SESSION_REDIS_URL` | Redis/Redis-TLS URL for encrypted SSO sessions; required for production SSO. |
| `REEF_SESSION_ENCRYPTION_KEY` | Independent base64/base64url-encoded 32-byte AES key; required for production SSO. |
| `REEF_LLM_API_KEY` | Server-side key for the configured OpenAI-compatible LLM endpoint. |
| `REEF_LLM_BASE_URL` | Base URL for the configured OpenAI-compatible LLM endpoint. |
| `REEF_LLM_MODEL` | Deployment-selected model for an enabled LLM capability. |
| `OPENROUTER_API_KEY` | Compatibility alias for `REEF_LLM_API_KEY`. |
| `OPENROUTER_BASE_URL` | Compatibility alias for `REEF_LLM_BASE_URL`. |

Set all three LLM variables to enable AI, or leave all three empty to disable
it. Partial configuration fails closed. `REEF_LLM_BASE_URL` can point to
OpenRouter or an akb-platform gateway; Reef does not classify the endpoint by
provider or deployment mode. LLM state does not affect AKB or Keycloak
authentication. Canonical and compatibility alias values may be set together
only when they agree.

GitHub features (monitored repositories, activity scan, and code grounding) are
deployment-managed through `REEF_GITHUB_APP_ID`,
`REEF_GITHUB_APP_INSTALLATION_ID`, and `REEF_GITHUB_APP_PRIVATE_KEY`, with an
optional read-only `REEF_GITHUB_PAT` fallback for local development and CI. When
none of them is set, those GitHub features are unavailable and reef runs on AKB
alone; the hermetic E2E harness mocks GitHub instead. See
[`../../docs/deployment.md`](../../docs/deployment.md) for the full GitHub
credential model.

In SSO mode, Reef is the OIDC client and AKB supplies only its public versioned
auth/provider catalog plus the account/API authority. Reef never calls AKB's
retired browser-login or JWT-exchange endpoints. Production SSO requires Redis,
the independent encryption key, and a distinct in-cluster Keycloak transport;
only tests and non-production development may use the in-memory store or public
issuer transport. See `../../docs/keycloak-sso.md`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/app/` | App Router pages, layouts, modal routes, and Route Handlers. |
| `src/features/` | Product feature areas: issues, board, timeline, planning, activity, AI, reports, settings, onboarding, auth, search, preferences, and shared UI state. |
| `src/components/` | Shared UI components and field leaves used across features. |
| `src/lib/` | Browser/API helpers, AKB/session helpers, logging, metrics, telemetry, and browser storage helpers. |
| `src/server/` | Server-only provider adapters, credential resolution, agent application code, and prompts/tools. |
| `src/providers/` | App-level providers such as TanStack Query persistence. |
| `tests/e2e/` | Playwright e2e tests. |
| `tests/evals/` | LLM prompt and agent evals. |

## State and persistence

- TanStack Query owns server/data state.
- Zustand owns ephemeral UI state.
- Dexie IndexedDB stores browser-local `config` only. The legacy `credentials`
  store was removed when the browser GitHub PAT path moved to deployment-managed
  GitHub App credentials.
- Authentication is not browser JavaScript state. In local mode
  `__reef_session` contains AKB's JWT; in SSO mode it contains only a random
  opaque handle and the encrypted token set stays server-side.
- Monitored repos, project prefix, issue templates, and planning catalog data
  come from AKB through Route Handlers and `@reef/core`.

Browser storage changes require the migration policy in
`../../docs/migration-policy.md`: Dexie store changes need a version bump and
persisted query shape changes may need a TanStack Query buster bump.

## Route Handler rules

- Validate request payloads and query params with Zod.
- Resolve the mode-aware `__reef_session` carrier through shared auth helpers.
  OIDC/token custody lives under `src/server/auth`; GitHub and LLM access is
  deployment-managed in `src/server/`. Route Handlers do not read
  browser-supplied provider credentials.
- Call the server application for GitHub/LLM/agent behavior and `@reef/core` for
  AKB/domain behavior.
- Use the redacting logger for request and error logging.
- Keep credentials in headers or httpOnly cookies, never URL query strings.
- Preserve `/api/agents/runs` streaming behavior; deployment proxy buffering
  must stay disabled for streaming routes.

## Commands

Run from the repository root:

```bash
pnpm --filter @reef/web run typecheck
pnpm --filter @reef/web run test
pnpm --filter @reef/web run test:e2e
pnpm --filter @reef/web run test:e2e:sharded
pnpm --filter @reef/web run dev:e2e
pnpm --filter @reef/web run test:eval
pnpm --filter @reef/web run build
```

Root shortcuts:

```bash
pnpm dev
pnpm build
pnpm check:turbo-contract
pnpm lint
pnpm typecheck
pnpm test
```

## E2E Harness

`pnpm --filter @reef/web run test:e2e` runs the hermetic Playwright suite by default.
The suite starts reef-web on `localhost:7353` and its Route Handlers for real,
plus a local fixture server on `127.0.0.1:7354` for external dependencies:

- AKB backend: mocked under `/akb`
- OpenRouter: mocked under `/openrouter`
- GitHub: mocked under `/github`

Default specs must be named `*.hermetic.spec.ts`. They should sign in through
the real login UI and `/api/auth/akb/login`, then reset fixture data with
`/__e2e/reset` before each test. Legacy UI-only specs were removed after their
useful flows were moved onto the hermetic fixture server.

`dev:e2e` is also the repository-owned live E2E runtime. It emits a private
ready payload with the web and fixture origins plus health, reset, discovery,
and scenario contracts. The fixture discovery endpoint is available at
`/__e2e/runtime`; it lists supported scenarios, test-only `fixture_login`
metadata, and user-task starting points without exposing selectors or
assertions.

Consumers interact with the running web and fixture services through their
browser and HTTP surfaces. Reef does not package a portable execution runner or
canonical behavior artifact. Canonical behavior and assertions remain in the
hermetic Playwright specs.

For a faster local full run, use:

```bash
pnpm --filter @reef/web run test:e2e:sharded
```

This builds reef-web once, then starts one isolated standalone server and
fixture-server pair per shard, offsetting ports by 10 (`7353`/`7354`,
`7363`/`7364`, ...), and passes `--shard` to Playwright. Override the shard
count with `--shards N`, or pass Playwright filters after `--`, for example:

```bash
pnpm --filter @reef/web run test:e2e:sharded -- --grep "settings"
```

For browser runtime checks after UX or layout work, run:

```bash
pnpm --filter @reef/web run dev:e2e
```

This starts the fixture server and reef-web with the same mock AKB, OpenRouter,
and GitHub endpoints, then leaves `http://localhost:7353` open for a real web
browser. Read `/__e2e/runtime` for the test-only `fixture_login` metadata, use
its login path to sign in, and select `reef-e2e`. Reset the fixture while the
server is running with:

```bash
pnpm --filter @reef/web run reset:e2e -- configured
```

## Deployment

`next.config.ts` sets `output: "standalone"` for Docker. The root `Dockerfile`
prunes this workspace with the repository-pinned Turbo version, builds it from
the pruned workspace, and runs the standalone server as a non-root user on port
`3000` inside the container. Local dev still runs on port `7333`.

## Related docs

- [Root README](../../README.md)
- [Root agent contract](../../AGENTS.md)
- [Web package rules](AGENTS.md)
- [Architecture](../../docs/architecture.md)
- [UX design](../../docs/ux-design.md)
- [Migration policy](../../docs/migration-policy.md)
