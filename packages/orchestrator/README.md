# @reef/orchestrator

Background orchestration runtime for Reef.

This package is the process boundary for long-running orchestration work. The
web package stays responsible for UI and dispatch/control-plane Route Handlers;
the orchestrator owns worker startup, idle polling, and graceful shutdown.

Run a dry-run startup smoke check:

```sh
REEF_ORCHESTRATOR_VAULT=reef-test pnpm --filter @reef/orchestrator smoke:dry-run
```

The dry-run path validates configuration and reports redacted readiness without
creating an AKB adapter, reading source rows, or writing a checkpoint.

## Notification projector

The worker projects activity and newly-created comments into `reef_notifications`.
Run at most one active orchestrator for a vault. A normal process needs a
deployment-managed AKB origin and exactly one credential source:

```sh
REEF_ORCHESTRATOR_VAULT=reef-test \
REEF_AKB_BASE_URL=https://akb.example \
REEF_AKB_JWT_FILE=/run/secrets/reef-akb-jwt \
pnpm --filter @reef/orchestrator start
```

`REEF_AKB_JWT` is the alternative for an injected secret value. A credential
file must be a regular file with mode `0600`; the runtime never prints the
credential, its file contents, or its path. Missing or partial AKB config fails
before the worker begins. `REEF_AKB_JWT` and `REEF_AKB_JWT_FILE` cannot be used
together.

The first non-dry-run creates a durable `notification_projector_v1` state in
the existing `reef_settings` JSON envelope and starts both cursors at that
activation boundary. It never backfills earlier activity or comments. Every
event is checkpointed only after all of its recipient notification writes have
converged through the existing deterministic notification key.

For recovery, restart the same worker with unchanged configuration: it resumes
the per-source checkpoint and safely replays an unfinished event. To roll back,
stop the worker; do not delete or edit the checkpoint, source rows, or existing
notifications. Choosing a new activation point or a historical backfill is an
explicit operator decision outside this runtime.
