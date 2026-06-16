# reef

> An agentic, AKB-backed issue tracker that keeps a team's issues, plans, and
> reports in sync with what developers and coding agents are actually doing in
> code.

reef sits between issue tracking and developer-shaped reality. Teams work in
issues, priorities, statuses, plans, and reports; developers and coding agents
leave evidence in commits, pull requests, branches, and code changes. reef reads
monitored GitHub repositories read-only and turns that activity into reviewable
signal: draft issues for untracked work, proposed status transitions for work
that moved forward, and grounded AI answers about the workspace.

Writes stay human-reviewed. AI enrichment, activity-scan drafts, and status
change proposals are suggestions until a user approves them.

## About AKB

reef requires the AKB backend to run. AKB is a separate Dnotitia product
([github.com/dnotitia/akb](https://github.com/dnotitia/akb)) that stores reef's
workspaces, issue documents, and `reef_issues` rows. reef does not bundle AKB;
it reaches a running AKB instance over HTTP through the `AKB_BACKEND_URL`
environment variable.

> Issue ids like `REEF-XXX` refer to Dnotitia's internal reef instance and do not
> resolve as public GitHub issues.

## What reef does

- Tracks issues in an AKB-backed workspace.
- Renders issue board, list, timeline, planning, activity, reports, settings,
  onboarding, and login views in a stateless Next.js web app.
- Stores issue bodies in AKB task documents and queryable issue fields in
  `reef_issues` rows.
- Reads monitored GitHub repositories for grounding only; it does not write to
  GitHub, clone repos, or create pull requests.
- Uses deployment-managed LLM configuration to power chat, issue enrichment, and
  activity-scan agents.
- Keeps per-user secrets out of server storage: the AKB session is an httpOnly
  cookie, and the GitHub PAT lives only in browser IndexedDB.

## Repository layout

This is a public pnpm monorepo. The root `package.json` is the single product
version source of truth; the workspace packages are not published to a registry
and are consumed in-workspace only.

| Path | Purpose |
| --- | --- |
| `packages/core` | Framework-agnostic TypeScript library (`@reef/core`) for schemas, models, adapters, agents, tools, and errors. GitHub, AKB, and LLM calls originate here. |
| `packages/web` | Next.js App Router application and stateless BFF. Route Handlers under `src/app/api/*` validate requests, extract credentials, call `core`, and translate errors. |
| `docs/` | Product, UX, release, migration, and mockup documentation. |
| `deploy/` | Kubernetes deployment assets. |
| `scripts/` | Repository automation, including release-policy checks. |
| `AGENTS.md` | Cross-cutting engineering contract for AI agents working in this repo. |

Package-local rules live in `packages/core/AGENTS.md` and
`packages/web/AGENTS.md`.

## Requirements

- Node.js 22+
- pnpm 10.27.0, via the root `packageManager` field
- A reachable AKB backend

## Quick start

Install workspace dependencies:

```bash
pnpm install
```

reef talks to AKB through `AKB_BACKEND_URL`; AKB does not need to run in this
repository or on the same host. For local development, one convenient option is
the AKB Docker Compose setup. That option requires Docker Desktop and a checkout
of the [AKB repository](https://github.com/dnotitia/akb). From the root of your
AKB checkout:

```bash
cp config/app.yaml.example config/app.yaml
cp config/secret.yaml.example config/secret.yaml
docker compose up -d
curl http://localhost:8000/livez
```

Point reef at wherever AKB is reachable by setting `AKB_BACKEND_URL` (see below);
it defaults to `http://localhost:8000` for the local Compose setup.

Create the reef web environment file:

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

Start reef:

```bash
pnpm dev
```

Open [http://localhost:7333](http://localhost:7333).

## Environment

reef-web is intentionally stateless. Environment variables are server-side and
deployment-managed; do not add `NEXT_PUBLIC_*` variables for secrets.

| Variable | Required | Description |
| --- | --- | --- |
| `AKB_BACKEND_URL` | Yes | Base URL for the AKB backend, for example `http://localhost:8000` locally. |
| `OPENROUTER_API_KEY` | For AI features | Server-side OpenRouter API key. Never store per-user LLM keys. |
| `OPENROUTER_BASE_URL` | Yes for AI features | OpenRouter-compatible base URL. Defaults locally to `https://openrouter.ai/api/v1`. |
| `REEF_LLM_MODEL` | Yes for AI features | Deployment-selected model used by the LLM adapter. |

User-specific credentials live elsewhere:

- AKB session: `__reef_session` httpOnly cookie, decoded read-only per request
  and forwarded to AKB as `Authorization: Bearer <pat>`.
- GitHub PAT: browser IndexedDB only, attached per request for monitored-repo
  grounding as `Authorization: Bearer <github_token>`.

## Common commands

Run these from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the web app on [http://localhost:7333](http://localhost:7333). |
| `pnpm build` | Build the web app for production. |
| `pnpm lint` | Run `biome check .`. |
| `pnpm format` | Run `biome format --write .`. |
| `pnpm typecheck` | Run `tsc --noEmit` in every package. |
| `pnpm test` | Run every package's Vitest suite. |
| `pnpm check:release` | Enforce release-policy and changelog rules. |

Package-specific commands:

```bash
pnpm --filter @reef/core run typecheck
pnpm --filter @reef/core run test
pnpm --filter web run typecheck
pnpm --filter web run test
pnpm --filter web run test:e2e
pnpm --filter web run test:eval
```

The standard gates are:

```bash
pnpm biome check .
pnpm -r run typecheck
pnpm -r run test
```

## Data model

A reef issue is stored as two linked AKB records:

- an AKB task document with the plain-markdown body and AKB-native fields
- a `reef_issues` table row with the queryable projection used by board, list,
  timeline, reports, filters, and planning surfaces

The AKB document title is the uppercase reef id, such as `REEF-001`. Issue
bodies do not use YAML frontmatter, and there are no per-issue markdown files in
this repository.

New cross-boundary fields start in `packages/core/src/schemas`. Fields that need
filtering or sorting belong in typed AKB rows; ad-hoc fields belong in row
`meta`; body content belongs in the AKB document.

## Architecture guardrails

- `core` is framework-agnostic: no Next.js imports, no DOM APIs, and no business
  logic in `web`.
- Route Handlers are thin wrappers around `core`.
- Zod schemas in `packages/core/src/schemas` are the source of truth for data
  crossing package or API boundaries.
- GitHub access is read-only monitored-repo grounding.
- Chat tools are currently read-only; mutating tools must add approval flow.
- Streaming changes must preserve `/api/chat` SSE delivery.
- Release-impacting changes update `CHANGELOG.md` under `Unreleased`.

## More documentation

- [Architecture](docs/architecture.md)
- [UX design](docs/ux-design.md)
- [Deployment](docs/deployment.md)
- [Keycloak SSO deployment contract](docs/keycloak-sso.md)
- [Release policy](docs/release-policy.md)
- [Migration policy](docs/migration-policy.md)
- [Core package README](packages/core/README.md)
- [Web package README](packages/web/README.md)

## Deployment

The root `Dockerfile` builds the `packages/web` Next.js standalone output on
Node 22 and runs it as a non-root user. Kubernetes manifests live under
`deploy/k8s`.

Production deployments must provide `AKB_BACKEND_URL` and the deployment-managed
LLM environment variables server-side. Use `docs/release-policy.md` and
`docs/migration-policy.md` before tagging or deploying release-impacting
changes.

For AKB-backed Keycloak SSO, configure the AKB callback and post-login path as
described in [docs/keycloak-sso.md](docs/keycloak-sso.md). reef itself still
only needs `AKB_BACKEND_URL`; Keycloak client secrets remain AKB-owned.

## License

See [LICENSE](LICENSE).
