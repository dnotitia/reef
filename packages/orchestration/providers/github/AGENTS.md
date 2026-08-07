# `scm-provider-github` package rules

This package owns the concrete GitHub SCM adapter for `@reef/orchestrator`.

- Depend only on the provider-neutral orchestrator contract and the pinned
  `@octokit/rest` client. Do not import `@reef/core`, Reef/AKB adapters, web,
  persistence, scheduler, or controller code.
- The factory receives one explicit repository binding: provider-neutral id,
  GitHub owner/name, exact local working tree, expected remote identity, remote
  name, base branch, branch policy, and mutation permissions. Revalidate that
  binding before every operation.
- Git commands use argv with an exact cwd and a non-interactive, explicit
  environment. Never put credentials in remote URLs, argv, returned
  references, errors, or logs. Octokit is supplied as an opaque client boundary
  so credential ownership stays with the caller.
- Branch collisions, remote divergence, default-branch/tag/force/refspec
  attempts, permission denials, and unsafe paths or messages fail closed before
  mutation. Push is non-force and draft PR creation never merges, reviews,
  labels, assigns, or changes an existing ready PR.
- Keep resource paths, raw Git output, raw GitHub payloads, and mutable clients
  factory-local. Public references, artifacts, and `ProviderError` values must
  remain provider-neutral and secret-free.
- Tests use disposable real Git repositories and local bare remotes with a mock
  GitHub REST server. Every fixture owns and removes its temporary repository,
  server, and process state.
