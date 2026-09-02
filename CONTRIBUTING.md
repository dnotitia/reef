# Contributing to reef

Thanks for your interest in reef. This guide covers how to get a local
checkout running and what to verify before opening a pull request.

## Prerequisites

- **Node.js 24.15+** (the repo supports `node >= 24.15.0` via the root `engines`
  field and uses the exact `.node-version` execution pin `24.18.1`).
- **pnpm 11** (the root `packageManager` field pins the exact version; run
  `corepack enable` to let your shell pick it up automatically).
- A reachable AKB backend for anything beyond unit tests. The
  [README](README.md) describes a local AKB Docker Compose option.

## Install

From the repository root:

```bash
pnpm install --frozen-lockfile
```

This is a pnpm workspace, so a single install at the root wires up every
package.

## Repository layout

reef is a monorepo with four private, non-published packages:

- **`packages/core`** — framework-agnostic TypeScript library (`@reef/core`).
  No Next.js imports, no DOM APIs. Product AKB I/O originates here. New product
  behavior that touches schemas, models, AKB adapters, or shared contracts
  starts in `core`.
- **`packages/web` (`@reef/web`)** — the Next.js App Router application and its
  stateless BFF. Route Handlers under `src/app/api/*` are thin wrappers that
  validate requests, manage the session cookie, call `core`, and translate
  errors.
- **`packages/jira-migrator` (`@reef/jira-migrator`)** — the operator-run,
  one-shot Jira-to-Reef migration package. Jira access stays read-only; apply
  stages reconcile Reef targets through explicit target contracts.
- **`packages/event-processor` (`@reef/event-processor`)** — the private AKB
  Change Event composition root for notification projection.

Cross-cutting engineering rules live in [`AGENTS.md`](AGENTS.md), with
package-local rules in each workspace package's `AGENTS.md` and implementation rules in
nested `AGENTS.md` files. Please read the relevant `AGENTS.md` before making
changes in that area.

## Gates to run before opening a PR

Run the canonical non-E2E gate from the repository root and make sure it passes:

```bash
pnpm run check
```

This includes the Turbo graph/cache contract proof, discovered package builds,
isolated artifact smoke, dependency architecture, lint, typecheck, unit tests,
maintenance checks, and release policy. For a quick graph-only proof while
iterating on task configuration, run:

```bash
pnpm run check:turbo-contract
```
The full hermetic Playwright suite remains a separate required CI gate; run
`pnpm --filter @reef/web run test:e2e:sharded` when the required browser
environment is available. The local sharded command builds the standalone web
artifact once and reuses it for the shard processes. Fixing formatting is
`pnpm format`.

## Continuous integration

Every pull request runs the **lint**, **typecheck**, **test**, and
**release-policy** jobs. These run for external contributors too — they need no
secrets.

The **e2e** (Playwright) job consumes one exact-head Next production artifact
that CI builds once and shares across all three shards, including the discovered
workspace dependency build artifacts required by E2E imports. The LLM eval work
runs as separate follow-up tooling. Specs and jobs that require deployment
secrets (GitHub tokens, an LLM API key, etc.) self-skip when those secrets are
absent, so a fork PR still gets a complete, green CI signal without access to
repo secrets.

## Commit style

reef uses [Conventional Commits](https://www.conventionalcommits.org/). Use a
type prefix on the subject line:

- `feat:` — a new user-facing capability
- `fix:` — a bug fix
- `chore:` — tooling, deps, or housekeeping with no user-facing change
- `docs:` — documentation-only changes

An optional scope is welcome, for example `feat(web): ...` or
`fix(core): ...`.

If your change is release-impacting (a user, storage, or operational change),
add an entry under `## Unreleased` in [`CHANGELOG.md`](CHANGELOG.md). The
release-policy CI job enforces this.

## About `REEF-XXX` ids

You will see `REEF-XXX` identifiers in commit messages, the changelog, and PR
descriptions. These reference Dnotitia's internal reef instance and are not
required for external contributions — you do not need access to it to send a
fix. Feel free to open a GitHub issue to discuss a change before investing in
a large PR.

## Code of Conduct

Participation in this project is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md).
