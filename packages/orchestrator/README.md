# @reef/orchestrator

Background orchestration runtime for Reef.

This package is the process boundary for long-running orchestration work. The
web package stays responsible for UI and dispatch/control-plane Route Handlers;
the orchestrator owns worker startup, idle polling, and graceful shutdown.

Run a dry-run startup smoke check:

```sh
REEF_ORCHESTRATOR_VAULT=reef-test pnpm --filter @reef/orchestrator smoke:dry-run
```

The dry-run path loads deployment configuration and reports readiness without
claiming work.
