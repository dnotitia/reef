# @reef/validation-provider-local

Private local `ValidationProvider` adapter for `@reef/orchestrator`.

The factory binds one exact Git repository real path and one explicit child
environment. Each validation request is checked against the repository's full
candidate SHA and clean tracked/untracked state before its frozen, ordered
trusted commands run from the repository root. A non-zero command fails fast;
later checks are returned as `skipped`.

Stdout and stderr are captured independently with fixed byte limits and
configured redaction. Timeout and caller cancellation terminate the child
process group with a bounded grace period. Provider references, proof, and
errors contain no repository path, environment, process handle, raw error, or
unbounded output.

The package owns no retry policy, persistence, issue writes, scheduler, public
CLI, or Crabbox orchestration. The existing
`@reef/infrastructure-provider-local` package remains the separate Git
worktree/process infrastructure adapter.
