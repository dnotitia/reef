# REEF-414 Behavior Contract

## User-Visible Goal

A release or local developer can run one credential-safe startup gate that
converges every registered Reef workspace before Reef starts, while raw vaults
and long-running processes never receive migration credentials.

## Target

- Type: CLI and generated deployment artifact
- Launch: `node packages/schema-migrator/dist/cli.mjs`
- Image launch: `docker run --rm <image> node /app/schema-migrator/cli.mjs`
- Manifest: rendered `deploy/k8s/overlays/example`
- Allowed fixtures: isolated local mock AKB endpoint and sentinel-only fake key

## User Tasks and Expected Observable Behavior

1. Run against raw and Reef vaults: the report counts every visible vault,
   skips raw vaults, and completes all marked workspaces.
2. Run with the empty release catalog: full membership preflight and final
   schema verification still occur.
3. Replay a fixed phase: unchanged operations report no-op with the same
   checksum; changed operations fail with a conflict.
4. Inject a marker/member preflight failure: the CLI exits non-zero before the
   first migration mutation.
5. Inject a middle-workspace failure, then retry: later workspaces are untouched
   on the failed run and the retry converges.
6. Inspect the built image and rendered manifest: Node directly launches the
   bundled runner, the Deployment uses `Recreate`, the init container gates the
   app, only it references `reef-migration-secret`, and no migration Job exists.
7. Exercise the local wrapper: a failed migration never spawns Next.js; success
   spawns it once without the migration service key.
8. Put a sentinel in upstream errors and the fake credential: the sentinel is
   absent from stdout, stderr, JSON reports, and surfaced errors.

## Anti-Cheat Probes

- Change the mock inventory and confirm counts and vault names change.
- Run the same state twice and compare applied/no-op output.
- Fail a different workspace and confirm the stop boundary moves with it.
- Search captured output and child environment for the exact sentinel.

## Evidence Required

- Redacted terminal transcript and JSON behavior-validator report.
- Built-image command result and rendered-manifest summary.
- Exit codes, mutation counters, retry state, and sentinel-search result.

## Out Of Scope

- Production credentials or shared production workspaces.
- A concrete Reef table operation, data backfill, or schema-version increase.
- RollingUpdate compatibility and a standalone migration Job.
