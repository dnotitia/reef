# Migration Policy

reef has four migration surfaces with different owners and risk profiles:

- Browser storage owned by reef-web.
- Persisted client query cache owned by reef-web.
- akb-backed server data owned by akb, with reef-specific tables and documents
  accessed through akb APIs.
- Reef vault skill and runbook documents installed into each akb vault.

Migration notes must make the affected surface explicit. A release may require
more than one migration category.

## Browser Storage

Browser-owned persistent storage lives in IndexedDB through Dexie and in
localStorage through TanStack Query persistence.

Use a Dexie version bump when the IndexedDB store layout changes:

- Add a new `db.version(N).stores(...)` block.
- Preserve all historical version blocks.
- Add an `.upgrade()` function when existing user data needs transformation.
- Update the version-history comment in `packages/web/src/lib/storage/db.ts`.
- Add or update tests that open the current database version and cover the
  migration behavior.

Use a TanStack Query buster bump when persisted response shapes change in a way
that could mis-render old cached data:

- Update `PERSIST_BUSTER` in `packages/web/src/providers/QueryProvider.tsx`.
- Mention the cache invalidation in `CHANGELOG.md` under `Migration` or
  `Changed`, depending on user impact.

Browser migrations must never move the akb session into IndexedDB. The akb
session stays in the `__reef_session` httpOnly cookie, and GitHub credentials
stay deployment-managed server state rather than browser-local state.

## akb Compatibility

reef-web does not own direct akb database migrations. New vault provisioning is
handled through reef's akb adapter by `ensureReefTables`, while existing akb
database evolution must be handled through akb-owned migration mechanisms or an
approved operational runbook.

Do not commit ad hoc PostgreSQL migration files for akb-owned tables in this
repository.

When reef starts depending on a new akb table, column, document shape, or API
behavior:

- Update the relevant Zod schema in `packages/core/src/schemas` first.
- Update `ensureReefTables` for newly created vaults.
- Document the minimum akb compatibility requirement in `CHANGELOG.md`.
- Add release notes explaining whether existing vaults need an akb-side
  migration, a one-time backfill, or no action.
- Prefer extension fields in existing `meta` JSON when a field does not need to
  be filtered or sorted.

If a SQL backfill is unavoidable, keep it in the akb repository or in an
operator runbook owned by the deployment environment. The reef release note may
link to that runbook, but should not become the source of truth for akb DDL.

## Vault Skill Documents

Reef installs agent-facing vault skill and runbook documents from
`packages/core/src/adapters/akb/vaultSkill.ts` into each Reef workspace. These documents
tell generic AKB agents how to operate the Reef PM data model.

Treat changes to these documents as a migration-affecting change when they alter:

- Agent-visible workflows or hard rules.
- Table, document, or field semantics.
- Allowed status, issue type, planning, activity-inbox, or relationship values.
- The set of installed skill/runbook document paths.
- Instructions that need to be present in existing vaults for safe agent
  operation.

New vaults receive the current documents during workspace creation through
`installReefVaultSkill`. Existing vaults are not automatically updated just
because reef-web is deployed with newer `vaultSkill.ts` content, unless a route
or operator action explicitly reruns installation.

Every vault skill change must document one of these release outcomes:

- No existing-vault action required because the change only affects future
  workspaces or clarifies non-normative text.
- Existing vaults should be reinstalled opportunistically.
- Existing vaults must be reinstalled before agents rely on the new behavior.

If reinstall is required, release notes must state the intended mechanism. Until
automation exists, that mechanism may be an operator-run script or a one-off
admin action that calls the same `installReefVaultSkill` path used at workspace
creation.

## Operational Migration

Operational migrations include changes to:

- Kubernetes manifests.
- Docker image assumptions.
- Ingress or reverse proxy settings.
- Environment variables and secrets.
- Observability, tracing, metrics, or smoke-test requirements.

Each operational migration must document:

- Required action before deploy.
- Required action during deploy.
- Rollback behavior.
- Whether the old and new application versions can run concurrently.

Streaming changes require special care. `/api/agents/runs` depends on response
buffering being disabled at the proxy layer; any ingress or proxy change must
preserve that behavior and should be covered by an SSE smoke test.

## Release Notes

Every migration-affecting pull request should add a `CHANGELOG.md` entry under
`Unreleased`.

Use the `Migration` section for required action and the `Operational` section
for deployment-risk context. If a migration is intentionally not required, say
so when that fact is important for operators.

Good release-note examples:

- `Migration: Bumped Dexie to v10 and backfilled cached issue snapshots with
  nullable release_id. Existing drafts are preserved.`
- `Migration: Requires akb release X.Y.Z or later because reef now reads the
  reef_releases table. Existing vaults need the akb-owned planning-table
  migration before deploy.`
- `Migration: Updated Reef vault skill runbooks for release planning workflows.
  Existing vaults should rerun vault skill installation before using generic AKB
  agents for release assignment.`
- `Operational: Production deploy should use reef-web:v0.3.0 instead of latest;
  rollback to v0.2.2 is safe because no storage migration is required.`
