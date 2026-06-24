# @reef/web

Next.js App Router application package for reef. `@reef/web` renders the product
UI and acts as a stateless Backend-for-Frontend over AKB-managed workspaces. It
consumes domain behavior from `@reef/core`; Route Handlers should stay thin.

reef-web persists no user-specific server state. The AKB session stays in the
`__reef_session` httpOnly cookie, GitHub access is deployment-managed through a
server GitHub App (with an optional server-side `REEF_GITHUB_PAT` fallback for
local and CI), and LLM configuration is deployment-managed server environment.

## Responsibilities

- Render the issues workspace, board, list, timeline, planning, activity,
  reports, settings, onboarding, and login views.
- Expose Route Handlers under `src/app/api/*` that validate inputs, extract
  credentials, call `@reef/core`, and translate errors into PM-facing HTTP
  responses.
- Manage browser-local UI state through Dexie, localStorage, and TanStack Query
  persistence where appropriate.
- Stream chat and agent runs to the client while preserving SSE-compatible
  delivery.
- Build a Next.js standalone output for Docker.

## Local setup

Prerequisites:

- Node.js 22+
- pnpm 10.27.0
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
AKB_BACKEND_URL=http://localhost:8000
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
REEF_LLM_MODEL=deepseek/deepseek-v4-flash
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
| `AKB_BACKEND_URL` | Base URL for the AKB backend. Local dev usually uses `http://localhost:8000`. |
| `OPENROUTER_API_KEY` | Server-side OpenRouter key for AI features. |
| `OPENROUTER_BASE_URL` | OpenRouter-compatible API base URL. |
| `REEF_LLM_MODEL` | Deployment-selected model for the LLM adapter. |

GitHub features (monitored repositories, activity scan, and code grounding) are
deployment-managed through `REEF_GITHUB_APP_ID`,
`REEF_GITHUB_APP_INSTALLATION_ID`, and `REEF_GITHUB_APP_PRIVATE_KEY`, with an
optional read-only `REEF_GITHUB_PAT` fallback for local development and CI. When
none of them is set, those GitHub features are unavailable and reef runs on AKB
alone; the hermetic E2E harness mocks GitHub instead. See
[`../../docs/deployment.md`](../../docs/deployment.md) for the full GitHub
credential model.

Keycloak SSO is configured on the AKB side. reef-web still only needs
`AKB_BACKEND_URL`; see `../../docs/keycloak-sso.md` for the AKB callback,
post-login path, and known logout/error redirect follow-up.

## Layout

| Path | Purpose |
| --- | --- |
| `src/app/` | App Router pages, layouts, modal routes, and Route Handlers. |
| `src/features/` | Product feature areas: issues, board, timeline, planning, activity, AI, reports, settings, onboarding, auth, search, preferences, and shared UI state. |
| `src/components/` | Shared UI components and field leaves used across features. |
| `src/lib/` | API client helpers, AKB/session helpers, logging, metrics, telemetry, LLM config, and browser storage helpers. |
| `src/providers/` | App-level providers such as TanStack Query persistence. |
| `tests/e2e/` | Playwright e2e tests. |
| `tests/evals/` | LLM prompt and agent evals. |

## State and persistence

- TanStack Query owns server/data state.
- Zustand owns ephemeral UI state.
- Dexie IndexedDB stores browser-local `config` only. The legacy `credentials`
  store was removed when the browser GitHub PAT path moved to deployment-managed
  GitHub App credentials.
- The AKB session is not browser JavaScript state; it lives in the
  `__reef_session` httpOnly cookie.
- Monitored repos, project prefix, issue templates, and planning catalog data
  come from AKB through Route Handlers and `@reef/core`.

Browser storage changes require the migration policy in
`../../docs/migration-policy.md`: Dexie store changes need a version bump and
persisted query shape changes may need a TanStack Query buster bump.

## Route Handler rules

- Validate request payloads and query params with Zod.
- Extract the AKB session from the `__reef_session` cookie. GitHub access is
  deployment-managed in `@reef/core`; Route Handlers do not read browser-supplied
  GitHub credentials.
- Call `@reef/core` for business logic and external service access.
- Use the redacting logger for request and error logging.
- Keep credentials in headers or httpOnly cookies, never URL query strings.
- Preserve `/api/chat` streaming behavior; deployment proxy buffering must stay
  disabled for streaming routes.

## Commands

Run from the repository root:

```bash
pnpm --filter @reef/web run typecheck
pnpm --filter @reef/web run test
pnpm --filter @reef/web run test:e2e
pnpm --filter @reef/web run dev:e2e
pnpm --filter @reef/web run test:eval
pnpm --filter @reef/web run build
```

Root shortcuts:

```bash
pnpm dev
pnpm build
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

For browser runtime checks after UX or layout work, run:

```bash
pnpm --filter @reef/web run dev:e2e
```

This starts the fixture server and reef-web with the same mock AKB, OpenRouter,
and GitHub endpoints, then leaves `http://localhost:7353` open for a real web
browser. Sign in with the fixture account `alice` / `password` and select
`reef-e2e`. Reset the fixture while the server is running with:

```bash
pnpm --filter @reef/web run reset:e2e -- configured
```

## Deployment

`next.config.ts` sets `output: "standalone"` for Docker. The root `Dockerfile`
builds this package and runs the standalone server as a non-root user on port
`3000` inside the container. Local dev still runs on port `7333`.

## Related docs

- [Root README](../../README.md)
- [Root agent contract](../../AGENTS.md)
- [Web package rules](AGENTS.md)
- [Architecture](../../docs/architecture.md)
- [UX design](../../docs/ux-design.md)
- [Migration policy](../../docs/migration-policy.md)
