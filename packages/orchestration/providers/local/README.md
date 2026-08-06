# Local infrastructure provider

`@reef/infrastructure-provider-local` is a private concrete
`InfrastructureProvider`. A factory binds one repository root, one managed
worktree root, one locally resolvable base revision, and one explicit child
environment.

Provisioning creates a detached Git worktree without changing the primary
checkout. Commands run in that worktree, use a caller-supplied relative cwd, and
receive no inherited environment. Resource references contain no filesystem
paths or process handles. Sync, cancellation, and cleanup revalidate ownership
before changing provider-owned state.

The package deliberately does not fetch, push, create branches, persist state,
interpret Reef configuration, or expose a CLI.
