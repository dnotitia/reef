# `infrastructure-provider-local` package rules

This package owns the concrete local Git worktree and child-process adapter.

- Keep the provider private and provider-neutral: depend only on
  `@reef/orchestrator`; do not import Reef, AKB, GitHub, Codex, web, or
  persistence code.
- The configured repository is the user's primary checkout. Never reset, clean,
  checkout, branch, stash, fetch, push, or otherwise mutate it. Git worktree
  registration and removal are the only shared-repository operations allowed.
- Git arguments are argv values. The caller's command string is the only shell
  boundary, and its child receives only the explicitly configured environment.
- Resource references are opaque. Keep paths, hooks, child handles, and raw
  output in factory-local memory; never place them in references or errors.
- Revalidate repository identity, worktree ownership, real-path containment, and
  the expected detached revision before every operation. Cleanup may remove only
  this provider's exact worktree path and registration.
- Tests use real temporary Git repositories and disposable directories. They must
  leave no repository, process, or proof artifact behind.
