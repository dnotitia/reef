# reef

> Agentic, AKB-backed issue tracking that keeps issues, plans, and reports in
> sync with what developers and coding agents actually do in your GitHub repos.

reef is an AKB subproject and reference product. It shows how AKB can be the
durable workspace behind an agentic application: documents for human-readable
knowledge, tables for queryable product state, HTTP APIs for the web app, and an
agent-friendly data model that coding agents can operate on.

In reef, that AKB-backed workspace becomes issue tracking for teams using GitHub
and coding agents. reef reads monitored repositories, compares that evidence
with the team's AKB issue workspace, and proposes draft issues, status
transitions, and grounded AI answers. People stay in control: AI enrichment,
activity-scan drafts, and status changes are suggestions until a user approves
them.

## What reef shows about AKB

- **AKB can back a full product surface.** reef stores workspaces, issue bodies,
  planning data, templates, settings, and membership in AKB while keeping the web
  tier stateless.
- **Documents and tables work together.** Issue bodies live as AKB task
  documents, while board/list/report fields live in typed `reef_issues` rows.
- **Agentic workflows can stay reviewable.** Enrichment and activity detection
  show their rationale before changing issue fields, so the human remains the
  author and decision maker.
- **Project state can follow real work.** reef reads commits, pull requests,
  branches, and code search results from monitored GitHub repositories to
  identify work that moved forward or was never tracked.
- **Credentials stay at the edges.** The AKB session is an httpOnly cookie, the
  GitHub PAT stays in browser IndexedDB, and GitHub access is read-only.

## Try reef locally

### UI preview

For a quick UI preview, you can run reef against the hermetic fixture harness.
It exercises reef-web and its Route Handlers for real while replacing AKB,
OpenRouter, and GitHub with local fixtures:

```bash
pnpm install
pnpm --filter @reef/web run dev:e2e
```

Open [http://localhost:7353](http://localhost:7353), sign in with
`alice` / `password`, and select `reef-e2e`.

To reset the fixture while `dev:e2e` is running:

```bash
pnpm --filter @reef/web run reset:e2e -- configured
```

### Source development

For development against a real AKB backend, create the web environment file and
point reef at the backend:

```bash
cp packages/web/.env.example packages/web/.env.local
pnpm dev
```

By default, `packages/web/.env.local` points `AKB_BACKEND_URL` at
`http://localhost:8000`. See [Development with AKB](#development-with-akb) when
you want a real AKB-backed workspace.

### Docker

To try the production-style reef-web container against a reachable AKB backend,
build the image and run it on port `3000`:

```bash
docker build -t reef-web:local .
docker run --rm -p 3000:3000 \
  -e AKB_BACKEND_URL=http://host.docker.internal:8000 \
  -e OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
  -e OPENROUTER_BASE_URL=https://openrouter.ai/api/v1 \
  -e REEF_LLM_MODEL=deepseek/deepseek-v4-flash \
  reef-web:local
```

Open [http://localhost:3000](http://localhost:3000). If AKB runs in the same
Docker Compose network as reef-web, use the AKB service name in
`AKB_BACKEND_URL` instead, for example `http://akb-backend:8000`. Add
`REEF_PUBLIC_ORIGIN=http://localhost:3000` when testing AKB-delegated SSO
locally.

## What reef includes

| Surface | What it provides |
| --- | --- |
| Issues | Board, list, timeline, backlog, detail editing, relations, labels, and filters. |
| Activity Hub | Reviewable draft issues and status-change proposals inferred from monitored repo activity. |
| Ask AI | Read-only, code-grounded answers about the workspace and monitored repositories. |
| Planning and reports | Planning catalog, release/milestone/sprint context, health summaries, and risk views. |
| Workspace settings | Workspace membership, monitored repositories, preferences, and deployment status. |

## Repository layout

This is a public pnpm monorepo. The root `package.json` is the single product
version source of truth; the workspace packages are private and consumed only
inside this repository.

| Path | Purpose |
| --- | --- |
| `packages/core` | Framework-agnostic TypeScript library (`@reef/core`) for schemas, models, adapters, agents, tools, and errors. GitHub, AKB, and LLM calls originate here. |
| `packages/web` | Next.js App Router application package (`@reef/web`) and stateless Backend-for-Frontend. Route Handlers validate requests, extract credentials, call `core`, and translate errors. |
| `docs/` | Architecture, UX, deployment, migration, release, and maintenance documentation. |
| `deploy/` | Kubernetes deployment assets. |
| `scripts/` | Repository automation, including release-policy and maintenance checks. |

Package-local engineering rules live in `packages/core/AGENTS.md` and
`packages/web/AGENTS.md`.

## Development with AKB

reef stores workspaces, issue documents, and `reef_issues` rows in
[AKB](https://github.com/dnotitia/akb). reef does not bundle AKB; it reaches a
running AKB backend over HTTP through `AKB_BACKEND_URL`.

For local development with real data, run or port-forward an AKB backend, copy
`packages/web/.env.example` to `packages/web/.env.local`, and set
`AKB_BACKEND_URL` to that backend. The `@reef/web` README covers the detailed
local setup; the deployment guide covers production environment variables,
Kubernetes, Docker, and SSO.

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

The standard gates are:

```bash
pnpm biome check .
pnpm -r run typecheck
pnpm -r run test
```

## Architecture at a glance

reef has three runtime tiers:

- **AKB** stores workspaces, issue documents, issue rows, templates, planning
  data, and settings.
- **reef core** is the framework-agnostic domain package, published inside the
  workspace as `@reef/core`. It owns schemas, domain models, adapters, AI
  agents, tools, and typed errors, and it is the only place GitHub, AKB, and LLM
  I/O originates.
- **reef web** is the Next.js application package, named `@reef/web` in the
  workspace. It renders the product UI and acts as a stateless
  Backend-for-Frontend over reef core.

For the full boundary, storage, credential, and streaming contracts, read
[docs/architecture.md](docs/architecture.md).

## Deployment

The root `Dockerfile` builds the `packages/web` Next.js standalone output on
Node 22 and runs it as a non-root user. Kubernetes manifests live under
`deploy/k8s`.

Production deployments provide `AKB_BACKEND_URL` and deployment-managed LLM
environment variables server-side. SSO is delegated through AKB; reef itself
still only needs the AKB backend origin and, for cross-origin SSO, the public
reef origin. See [docs/deployment.md](docs/deployment.md) and
[docs/keycloak-sso.md](docs/keycloak-sso.md).

## Documentation

- [Architecture](docs/architecture.md)
- [UX design](docs/ux-design.md)
- [Deployment](docs/deployment.md)
- [Keycloak SSO deployment contract](docs/keycloak-sso.md)
- [Release policy](docs/release-policy.md)
- [Migration policy](docs/migration-policy.md)
- [Maintenance](docs/maintenance.md)
- [Core package README](packages/core/README.md)
- [`@reef/web` package README](packages/web/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## About `REEF-XXX` ids

`REEF-XXX` ids in commit messages, changelog entries, or docs reference
Dnotitia's internal reef instance and do not resolve as public GitHub issues.
They are not required for external contributions.

## License

Apache-2.0. See [LICENSE](LICENSE).
