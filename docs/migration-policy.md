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

Browser migrations must never move the akb session into IndexedDB. Local mode
stays in the `__reef_session` httpOnly cookie; SSO mode stays in its opaque
`__reef_auth_v2` handle and encrypted server custody. GitHub credentials
stay deployment-managed server state rather than browser-local state.

## AKB Schema Ownership

AKB is the only owner of Reef table schemas. Reef keeps the canonical table
manifest and release projection in Core so it can describe and verify the
required shape, but Reef runtime paths do not create, alter, drop, migrate, or
stamp those tables.

Before Reef product APIs or agent runs use a workspace, Core checks AKB's
canonical app-installation status, reads the required table catalog, compares
table names, columns, types, required flags, unique keys, and indexes with the
canonical projection, then checks the existing Reef data initialization
(config, templates, and vault-skill documents). A missing, malformed, forbidden,
unavailable, or mismatched table catalog blocks workspace use. A readiness
check never repairs the schema. Authentication, account denial, canonical
inactive state, resource permission denial, transport failure, malformed
response, and table mismatch keep their separate outcomes; a schema or resource
denial does not invalidate the user's session.

The `reef_settings.schema_version` row is not authoritative and is not read or
updated. `REEF_SCHEMA_VERSION` remains part of the release blueprint contract;
it does not represent per-vault schema state. Missing or stale local stamps have
no effect on readiness.

Workspace data initialization remains separate from schema ownership. After
AKB reports an installation active and the required table schema verifies, the
existing owner/admin initialization path may initialize missing Reef config,
default templates, and managed vault-skill documents. It preserves saved
settings, template edits, and user-owned documents. It never changes table
schemas or writes a schema stamp. Ordinary members cannot trigger that
initialization.

Changes to table shape must be expressed through the canonical release
projection and handled by AKB's app-installation and reconciliation workflow.
Reef must not add a request-time DDL path, a table migration API, a Reef-owned
migration ledger, a table-creation fallback, or a startup migration runner. AKB
release registration and rollout remain the deployment-owned schema gate; Reef
runtime readiness is a read-only verification after that gate. Required-table
metadata must be present and match before the workspace is exposed as ready.

스키마 v4 조회 인덱스는 readiness와 신규 설치 descriptor가 함께 사용하는
projection에 선언한다. 기존 v3 설치는 지정된 0.14.0, 0.15.0, 0.16.0 release와
v3 fingerprint가 정확히 일치할 때만 지원하며, AKB Release Manifest에 선언된
`add_index` 단계를 사용한다. 임의의 카탈로그 차이에서 전환을 추론하지 않는다.
rollout 적용 뒤 일치하는 Reef image를 배포하고, 인증된 Workspace Ready 검사가
성공할 때까지 workspace를 사용할 수 없게 둔다. 점검·실패·resume·image 복귀는
[배포 안내](deployment.md#register-and-deploy)를 따른다.

Keep ad-hoc extension fields in their owning `meta` or `payload` JSON envelope
when database-level filtering, sorting, joining, uniqueness, constraints, or
indexing is not required. When the canonical schema projection changes, record
the release impact in `CHANGELOG.md` and verify the AKB-managed install/reconcile
path and runtime readiness against the updated projection. Do not use a
per-vault `schema_version` value to imply that a schema transition ran.

## Vault Skill Documents

Reef installs agent-facing vault skill and runbook documents from
`packages/core/src/adapters/akb/vaultSkill.ts` into each Reef workspace. These documents
tell generic AKB agents how to operate the Reef PM data model.

Treat changes to these documents as a migration-affecting change when they alter:

- Agent-visible workflows or hard rules.
- Table, document, or field semantics.
- Allowed status, issue type, planning, notification, or relationship values.
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
