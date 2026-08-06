# Package contracts

reef keeps its private workspace packages consumable through explicit build
artifacts. The Next.js application remains an application package; it is not a
Node package entrypoint.

## Buildable packages

These six Node packages use the shared tsdown configuration to emit ESM
JavaScript and declaration files under `dist/`:

| Package | Role | Public entry |
| --- | --- | --- |
| `@reef/core` | Framework-agnostic domain, schema, adapter, and agent contracts | Root plus the existing `status`, `errors`, `fields`, and `fields/planning` subpaths |
| `@reef/orchestrator` | Provider-neutral one-run orchestration runtime | Root |
| `@reef/harness-provider-codex` | Codex harness provider | Root |
| `@reef/infrastructure-provider-local` | Local infrastructure provider for isolated Git-backed runs | Root |
| `@reef/work-provider-reef` | Reef work provider | Root |
| `@reef/jira-migrator` | Operator-run Jira migration tool | Root and the `reef-jira-migrator` bin |

Package exports point only at emitted files. Production consumers must not
resolve workspace `src/` files, TypeScript files, or compatibility wrappers.

The allowed workspace dependency directions are:

```text
core                         → (none)
orchestrator                 → core
harness-provider-codex       → orchestrator
infrastructure-provider-local → orchestrator
work-provider-reef           → core, orchestrator
jira-migrator                → core
web                          → core
```

The architecture gate also rejects cycles, unresolved imports, and production
imports of tests, fixtures, or test helpers.

## Local checks

`pnpm run check` is the contributor-facing non-E2E aggregate. It starts with
the package contract gate and then runs the repository lint, typecheck, test,
and release-policy checks:

```bash
pnpm run build:packages
pnpm run package-contract:smoke
pnpm run architecture:check
pnpm run check
```

The artifact smoke builds temporary package tarballs from the actual manifests
and `dist/` directories, installs all six packages in an isolated temporary
consumer with pnpm, and uses only pure Node ESM imports for every public root
and the existing core subpaths plus the installed `reef-jira-migrator --help`
bin. It rejects source/TypeScript files, source exports, and workspace links.
The temporary consumer and its package manager state are removed after the
check.
