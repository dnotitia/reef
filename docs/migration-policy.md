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

Reef separates table provisioning from table evolution. The four paths below
have different owners and must not be collapsed into an automatic hot-path
migration:

| Change | Owner and standard path |
| --- | --- |
| Add a new Reef table | Core's desired table manifest, a `REEF_SCHEMA_VERSION` bump, and `ensureReefTables` additive create/verify |
| Change an existing table's columns, constraints, unique keys, or indexes | An explicit operator workflow calling `akbApplyTableMigration` |
| Backfill or repair existing rows | A bounded, retry-safe AKB DML job owned by the deployment operator and kept separate from schema operations |
| Drop, rename, or contract a type or representation | A separately approved Contract-phase operator migration after the compatibility window and rollback prerequisites are satisfied |

`ensureReefTables` is the lazy self-heal path for a new workspace: it creates
missing tables and verifies existing tables against the desired manifest. It
must not ALTER an existing table. A manifest mismatch remains a hard failure so
that a user request, issue/comment/activity hot path, individual workspace
entry, or hot reload cannot silently acquire migration privileges or mutate a
live schema. Release startup uses the explicit pre-start gate defined below.

For an existing table, `akbApplyTableMigration` is the standard schema
primitive. AKB applies its ordered operations atomically and returns a typed
migration result tied to a caller-provided UUID. `akbAlterTable` remains a
low-level primitive for investigation or a deliberately isolated single
operation; it is not the normal release-rollout path because it does not provide
the same migration replay record. AKB may expose both endpoints to a writer, so
operator-only use is enforced by Reef's caller boundary and runbook, not by
assuming the upstream role is an administrator role. Service-identity wiring is
a separate security concern and must not be improvised as part of a schema
change.

Do not commit ad hoc PostgreSQL migration files for akb-owned tables in this
repository. Do not perform DDL with the DML backfill path, and do not hide an
existing-table mismatch by teaching `ensureReefTables` to repair it.

### Typed column promotion

Keep ad-hoc extension fields in the owning `meta` or `payload` JSON
compatibility envelope. Promote a field to a typed column only when the product
needs at least one database-level capability: filtering, sorting, joining,
uniqueness or another constraint, or an index. Display-only annotations and
fields that are merely carried through a response stay in JSON.

When a field qualifies, update its canonical Zod schema and the desired table
manifest for newly provisioned vaults. Existing vaults still follow the
operator migration phases below; changing the manifest does not authorize
`ensureReefTables` to ALTER them.

### Expand, Backfill, Enforce, Contract

Promoting an existing JSON field or otherwise tightening an existing table is a
four-phase rollout. Each phase is independently observable and retryable:

1. **Expand.** Add the typed column as nullable through an explicit operator
   migration. New application code may write the typed value, but readers must
   fall back to the legacy `meta` or `payload` value and writers must preserve a
   representation that the oldest supported reader understands. Do not combine
   the nullable add with a destructive drop, rename, or type contraction.
2. **Backfill.** Populate existing rows with a separate bounded DML job. Define
   deterministic conversion rules, count the target rows, invalid or
   unparseable values, and failures, and make retries skip values already
   filled rather than overwriting them. Schema success is not backfill success.
3. **Enforce.** Preflight until null, invalid-value, and duplicate counts that
   would violate the intended contract are zero. Repair data before adding a
   NOT NULL or uniqueness constraint; a constraint is never a duplicate-cleanup
   mechanism. Add constraints, unique keys, and indexes with a new migration
   phase UUID, then verify their presence and application reader/writer
   behavior.
4. **Contract.** After at least one compatible release and the documented
   rollback window, remove the legacy fallback or dual write. A drop, rename, or
   type contraction uses a separate issue, pull request, and migration UUID.
   Execute it only after proving that supported old readers and writers are no
   longer needed and that an inverse migration or data-restore plan exists.

For a type change, add a new nullable column, dual-read/write as required,
backfill it, enforce it, and remove the old column later. Never use an in-place
destructive type change to bypass the compatibility phases.

### Migration identity, replay, and evidence

Assign one stable UUID to each target-vault migration phase. Reuse that UUID for
every retry in the same vault and environment. The ordered operation list,
including every payload, is immutable once associated with the UUID:

- A first application returns an applied result and its checksum.
- An unchanged same-key retry may return a replay result such as
  `applied: false`; treat that as idempotent evidence, not a reason to mint a new
  key.
- The same key with a different operation, payload, or operation order is a
  checksum conflict. Fail closed, record the drift, and reconcile which
  operation list is authoritative. Do not bypass the conflict with a new UUID.

The pull request or operator runbook must record, without credentials:

- Reef issue id, target vault and environment, phase name, migration UUID, and
  immutable ordered operation list.
- Returned checksum, applied/replay result, and timestamps.
- Preflight target, null, invalid, and duplicate counts, plus any data-repair or
  backfill outcome.
- Postflight schema invariants, constraint/index presence, application
  reader/writer compatibility, and rollback observables.
- The condition that permits rollout to continue and the condition that stops
  or rolls it back.

### Release pre-start gate

Existing-table migrations run only in a release pre-start gate, before Reef
accepts user traffic or reports ready. The gate is a deployment-owned runner;
it is not a route, workspace-opening side effect, or repair action triggered by
an individual user. It must not accept a manually selected vault as the rollout
scope. Instead, it reads the authoritative Reef workspace inventory and treats
every registered workspace as part of the release.

The runner performs this sequence:

1. Confirm AKB readiness and authenticate with a non-interactive migration
   identity.
2. Enumerate every registered Reef workspace from the authoritative inventory.
3. Read each workspace's schema/version state and apply every pending phase in
   order with `akbApplyTableMigration` and that phase's stable UUID.
4. Confirm that any separately owned bounded backfill required before the next
   phase has completed and satisfies its preflight invariants.
5. After pending phases are applied, call `ensureReefTables` to create any new
   tables and verify the complete desired manifest and version stamp.
6. Start Reef, or mark it ready, only after every registered workspace passes.

The gate fails closed on inventory, identity, migration, backfill, replay,
checksum, or final-manifest errors. One failed workspace blocks application
startup/readiness for the release; the runner must not skip it, narrow the
inventory to a convenient vault, or defer repair until that workspace is first
opened. Re-running the whole gate is safe because phase UUIDs and operations
are stable and successful replays are evidence.

The non-interactive AKB identity, its least-privilege authorization, and the
authoritative registration/discovery contract are implementation
prerequisites. REEF-367 owns those identity and inventory decisions. REEF-414
owns the runner, migration catalog, deployment wiring, and development wrapper.
This policy does not implement any of them.

### Kubernetes and local development

The Kubernetes reference implementation runs the gate in an `initContainer` so
the migration credential is available only to the short-lived runner, not the
long-running Reef application container. A separate one-off Job is optional,
not a required part of this policy. While Reef requires exact desired-manifest
compatibility and old/new application concurrency has not been proven, the
Deployment strategy must be `Recreate`. `RollingUpdate` is allowed only after a
separate compatibility change proves mixed-version readers and writers safe for
every migration phase.

Local `pnpm dev` runs the same gate once, before starting the Next.js development
server. A gate failure prevents Next.js from starting, and hot reload does not
run migrations again. Local migration credentials must be supplied separately
from the general `.env.local` loaded by Next.js and removed from the child
process environment before the long-running server starts. Development uses an
isolated local AKB or explicitly allowed development workspaces, never reused
production credentials.

User requests, issue/comment/activity operations, individual workspace entry,
and hot reload remain migration-free in every environment. They may surface a
schema mismatch, but they do not call `akbApplyTableMigration` to repair it.

### Compatibility and rollback

Before each phase, verify the target AKB compatibility, current table shape,
data counts, migration history for the chosen UUID, and whether old and new
application versions can run concurrently. After each phase, verify the typed
result rather than relying only on a successful HTTP status.

During Expand and Backfill, application rollback ignores the new nullable
column and continues to read the legacy fallback. Leave the expanded column in
place; dropping it during an application rollback would turn a reversible
deployment into destructive schema work. Before Enforce, prove that the oldest
supported writer satisfies the proposed constraints.

Contract is not automatically reversible. If dropping or renaming data cannot
be undone with a tested inverse migration or restored from a defined backup,
do not execute that phase. If a destructive phase has already run, application
rollback alone is insufficient; follow the recorded inverse/data-restore plan.

Every AKB compatibility change must document the minimum upstream requirement
and whether existing vaults require a schema migration, a one-time backfill, a
vault-skill reinstall, or no action. A policy-only change that executes none of
these must say so explicitly in `CHANGELOG.md`.

REEF-030 is policy-only: it adds no runner, credential, initContainer manifest,
package script, schema operation, or data backfill. Those runtime changes must
land through their owning implementation issues.

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
