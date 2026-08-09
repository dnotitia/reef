# @reef/orchestration-cli

Private foreground adapter for one work-URI invocation. The executable artifact
is `dist/cli.js` and accepts one invocation:

```text
run <canonical-work-uri> --config <absolute-json-path>
```

The CLI reads one Reef work snapshot, builds an immutable provider-bound
`RunPlan`, claims the controller, and delegates the provider-neutral lifecycle
to `@reef/orchestrator`. Its Reef-specific delivery module then claims the
todo, provisions and binds one managed workspace, drives the Codex harness,
validates exact candidate heads, and hands a validated head to the configured
SCM and Reef work providers. A successful run links the branch, commit, proof,
and draft pull request before transitioning the work to `in_review`. Failed,
blocked, and cancelled runs do not create delivery artifacts or review state.
Credentials are never accepted in argv or JSON; the config names the
environment variables to read. `repository.branch` is the explicit push
target, and `delivery.max_validation_attempts` is a finite repair budget
(minimum two attempts).

## Canonical E2E commands

```bash
pnpm --filter @reef/orchestration-cli run test:e2e
pnpm --filter @reef/orchestration-cli run dev:e2e
```

`test:e2e` builds the package and runs the real `node dist/cli.js` child
process against isolated fixtures. Each run gets a unique temporary root,
controller state, Git working repository, bare remote, and OS-assigned port.
Local HTTP servers provide the Reef work and GitHub boundaries. The suite
covers exact-head success handoff, first-failure repair, blocked user input,
config and provider-resolution failures, duplicate claims, SIGINT
cancellation, redaction, cleanup, and isolation. The fixtures retain the
real built CLI and provider adapters.

`dev:e2e` keeps three synthetic fixtures (success, repair, and blocked) running
until it receives a termination signal. It is the source-blind behavior
runtime descriptor for Crabbox job `cli-e2e-runtime`; the runtime itself is
started by the orchestrator after candidate approval. Once ready, it prints
these source-neutral descriptor lines to stdout:

```text
REEF_E2E_READY=1
REEF_E2E_CLI_BEHAVIOR_JOB=cli-e2e-runtime
REEF_E2E_SUCCESS_WORK_URI=<synthetic success work URI>
REEF_E2E_REPAIR_WORK_URI=<synthetic repair work URI>
REEF_E2E_BLOCKED_WORK_URI=<synthetic blocked work URI>
REEF_E2E_SUCCESS_COMMAND=<synthetic-env + node dist/cli.js command>
REEF_E2E_REPAIR_COMMAND=<synthetic-env + node dist/cli.js command>
REEF_E2E_BLOCKED_COMMAND=<synthetic-env + node dist/cli.js command>
REEF_E2E_STOP=send SIGINT or SIGTERM to this runtime PID <pid>
```

The three scenario commands use fixture-only synthetic canaries, not real
credentials or production work items. A source-blind validator uses only the
descriptor and terminal: success must produce one exact-head proof and draft
PR handoff, repair must replace the first failed candidate with a new validated
head, and blocked must leave one PM-safe question pending without PR or review
handoff. On SIGINT or SIGTERM, the runtime removes its listeners and temporary
roots before exiting.

The CLI process exposes exactly one terminal JSON line on stdout, progress JSONL
on stderr, and an outcome-specific exit code: `0` for succeeded, `1` for
failed, `2` for config or provider preflight failure, `3` for a duplicate
claim, and `130` for cancellation. Secret canaries and private fixture paths
must not appear in CLI stdout or stderr, terminal results, or controller state.
