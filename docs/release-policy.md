# Release Policy

reef is versioned as a single repository product: the deployed `reef-web`
application plus its private core, worker, and operator packages.

The pnpm workspace contains `packages/web`, `packages/core`,
`packages/orchestrator`, and `packages/jira-migrator`. None is published or
versioned independently. Repository versioning therefore follows the product
release, not per-package library compatibility. A release may ship reef-web as
a container while distributing the orchestrator or Jira migrator from source or
build artifacts; those packages still follow the same root version and
changelog.

## Version Source

- Product versions use SemVer: `MAJOR.MINOR.PATCH`.
- Release tags use the `vX.Y.Z` format, for example `v0.2.0`.
- The root `package.json` is the product version source of truth.
- The user-visible application version and telemetry service version should read
  from the root `package.json`.
- Every `packages/*/package.json` is a private package manifest and must not
  define its own product version while it remains an unpublished workspace
  package.

If release automation later injects a build-time `REEF_VERSION`, that mechanism
may become the version source, but the policy should be updated in the same
change.

## SemVer Rules

While reef is below `1.0.0`:

- Patch: bug fixes, documentation, test-only changes, non-user-visible
  refactors, dependency bumps without behavior changes, and safe operational
  corrections.
- Minor: new user-facing features, meaningful UX changes, API response-shape
  changes, storage schema changes, akb table-shape expectations, deployment
  behavior changes, and any breaking change.
- Major: reserved for the post-`1.0.0` compatibility policy.

Every breaking change in the `0.x` series must be called out in `CHANGELOG.md`
under the release entry.

## Release Cadence

reef ships on a weekly cadence: one minor version every Friday (0.3.0, 0.4.0,
0.5.0, …). Planning maps onto that cadence:

- One sprint maps to one minor release (Sprint N ↔ vX.Y.0), Friday to Friday.
- A release is the weekly delivery bundle; its sprint is the matching timebox.
  They are 1:1.
- A milestone is a multi-week theme, decoupled from the version number.
  Milestones are not created per release; an issue keeps its milestone across
  the weekly releases that chip away at it.
- Epics are durable, multi-release containers. They live on a milestone with no
  release link and complete when their last child ships — never pin an epic to a
  weekly release.

## Iteration and Triage

- All open, schedulable work lives in the current release + sprint, and new
  issues are filed straight into it. Work is not pre-distributed across future
  releases — unfinished work is trimmed forward at the release cut, not sorted
  ahead of time.
- A not-yet-started future theme (its own milestone) may stay deferred with no
  release link until it is pulled into a sprint.

## Release Cut — Planning State

Alongside the code-side checklist below, at each release cut bring the planning
state in line with what shipped:

1. Mark the release shipped and close its active sprint.
2. Release-close that release's completed work: issues that are merged and
   awaiting release move to closed-as-completed. Issues closed for other reasons
   (duplicate / wont_fix / invalid / stale) are unaffected.
3. Open the next release and sprint.
4. Carry forward every still-open issue from the shipped release and sprint into
   the next one.

## Changelog Rules

`CHANGELOG.md` is the human-readable release ledger. Each release should move
entries from `Unreleased` into a dated version section:

```md
## v0.2.0 - YYYY-MM-DD
```

Use these section names when applicable:

- `Added`: new user-visible capabilities.
- `Changed`: changed behavior, workflows, UI, APIs, or internal architecture
  worth knowing about.
- `Fixed`: bug fixes.
- `Security`: security fixes or hardening.
- `Migration`: storage, akb, data, or compatibility steps required before or
  during deploy, including Reef vault skill/runbook document updates.
- `Operational`: Docker, Kubernetes, ingress, environment, secrets, observability,
  smoke tests, and rollback-relevant changes.

Pull requests should update `CHANGELOG.md` when they change user-visible
behavior, storage shape, deployment behavior, or operator responsibilities.
Pure refactors and test-only changes may skip the changelog unless they affect a
release risk.

## Release Checklist

Before creating a release tag:

1. Confirm the root `package.json` contains the target version.
2. Move `CHANGELOG.md` entries from `Unreleased` into the target version section.
3. Confirm migration notes are present for browser storage, persisted cache, akb
   compatibility, vault skill/runbook documents, operational config, or data
   backfills.
4. Run the standard gates:
   - `pnpm biome check .`
   - `pnpm run check:release`
   - `pnpm -r run typecheck`
   - `pnpm -r run test`
   - `pnpm --filter @reef/orchestrator run build`
   - `pnpm --filter @reef/jira-migrator run build`
   - `pnpm --filter @reef/web run test:e2e` when the required environment is available.
5. Confirm Docker image build and size checks pass.
6. Confirm streaming routes still pass the SSE smoke test for the target
   environment when staging is available.
7. Create an annotated git tag, for example:

```bash
git tag -a v0.2.0 -m "reef v0.2.0"
git push origin v0.2.0
```

## Docker Tags

Release images should be traceable by both immutable version and commit:

- `reef-web:vX.Y.Z`
- `reef-web:<git-sha>`
- `reef-web:latest` only as a convenience pointer for non-reproducible manual
  workflows.

Production deployment should prefer immutable version tags once release
automation supports them. `latest` may remain available for development and
manual smoke deployments, but it should not be the only deployable reference.

## GitHub Releases

GitHub Releases should be created from `CHANGELOG.md` entries. Release notes
must include:

- User-visible changes.
- Required migration or compatibility notes.
- Operational steps and rollback notes.
- Docker image tags for the release.
