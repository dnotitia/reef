# @reef/orchestration-cli

Private foreground adapter for one work-URI invocation. The executable artifact
is `dist/cli.js` and accepts one invocation:

```text
run <canonical-work-uri> --config <absolute-json-path>
```

The CLI reads one Reef work snapshot, builds an immutable provider-bound
`RunPlan`, claims the controller, and delegates the one-run boundary to
`@reef/orchestrator`. It does not select queued work, start a daemon, create a
workspace, order delivery, or deliver a branch or pull request. Credentials are
never accepted in argv or JSON; the config names the environment variables to
read.

## Canonical E2E commands

```bash
pnpm --filter @reef/orchestration-cli run test:e2e
pnpm --filter @reef/orchestration-cli run dev:e2e
```

`test:e2e` builds the package and runs the real `node dist/cli.js` child
process against an isolated fixture. Each run gets a unique temporary root,
controller state, Git working repository, bare remote, and OS-assigned port.
Local HTTP servers provide the Reef work and GitHub boundaries. The suite covers
success, config and provider-resolution failures, duplicate claims, SIGINT
cancellation, redaction, cleanup, and parallel isolation. The success fixture
also connects the real SCM adapter produced by the built resolver to the GitHub
API fixture without adding delivery behavior to the CLI.

`dev:e2e` keeps the same fixture running until it receives a termination
signal. Once ready, it prints these source-neutral descriptor lines to stdout:

```text
REEF_E2E_READY=1
REEF_E2E_WORK_URI=reef://fixture-vault/REEF-101
REEF_E2E_PORT=<fixture port>
REEF_E2E_CLI_COMMAND=<synthetic-env + node dist/cli.js command>
REEF_E2E_INVALID_CONFIG_COMMAND=<direct command>
REEF_E2E_PROVIDER_MISMATCH_COMMAND=<direct command>
REEF_E2E_DUPLICATE_COMMAND=<same direct command; run twice concurrently>
REEF_E2E_CANCEL_COMMAND=<same direct command; send SIGINT to its child>
REEF_E2E_STOP=send SIGINT or SIGTERM to this runtime PID <pid>
```

`REEF_E2E_CLI_COMMAND` contains fixture-only synthetic canaries, not real
credentials. A source-blind validator uses only the descriptor and terminal:
it starts the same command twice concurrently for the duplicate scenario and
sends SIGINT to the running child for cancellation. On SIGINT or SIGTERM, the
runtime removes its listeners and temporary root before exiting.

The CLI process exposes exactly one terminal JSON line on stdout, progress JSONL
on stderr, and an outcome-specific exit code: `0` for succeeded, `1` for
failed, `2` for config or provider preflight failure, `3` for a duplicate
claim, and `130` for cancellation. Secret canaries and private fixture paths
must not appear in CLI stdout or stderr, terminal results, or controller state.
