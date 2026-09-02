# Package contracts

reef keeps its private workspace packages consumable through explicit build
artifacts. The Next.js application remains an application package; it is not a
Node package entrypoint.

## Buildable packages

Every Node workspace package whose manifest declares `files: ["dist"]` uses
the shared tsdown configuration to emit ESM JavaScript and declaration files
under `dist/`. The table shows the current buildable packages:

| Package | Role | Public entry |
| --- | --- | --- |
| `@reef/core` | Framework-agnostic domain, schema, AKB adapter, observability, and provider-neutral agent contracts | Root plus the existing `status`, `errors`, `fields`, and `fields/planning` subpaths |
| `@reef/event-processor` | Private AKB Change Event tail and notification projection composition root | Root |
| `@reef/orchestrator` | Provider-neutral one-run orchestration runtime | Root |
| `@reef/orchestration-controller` | Controller-owned private run state, claims, inspection, and cleanup boundary | Root |
| `@reef/orchestration-cli` | Private foreground work-URI invocation adapter and executable artifact | Root and the `reef-orchestration-cli` bin |
| `@reef/harness-provider-codex` | Codex harness provider | Root |
| `@reef/infrastructure-provider-local` | Local infrastructure provider for isolated Git-backed runs | Root |
| `@reef/validation-provider-local` | Local validation provider for ordered checks and bounded proof | Root |
| `@reef/scm-provider-github` | Explicitly bound GitHub SCM provider for refs, branches, commits, pushes, and draft PRs | Root |
| `@reef/work-provider-reef` | Reef work provider | Root |
| `@reef/jira-migrator` | Operator-run Jira migration tool | Root and the `reef-jira-migrator` bin |

Package exports point only at emitted files. Production consumers must not
resolve workspace `src/` files, TypeScript files, or compatibility wrappers.
`@reef/core` additionally supports pnpm Git-subdirectory consumption for
development integrations. Its `prepare` lifecycle builds the same `dist/`
contract, and its manifest uses concrete dependency ranges so it remains valid
after pnpm selects `packages/core` outside the Reef workspace.

The allowed workspace dependency directions are:

```text
core                         → (none)
event-processor              → core
orchestrator                 → core
orchestration-controller     → orchestrator
orchestration-cli            → core, orchestrator, orchestration-controller, concrete providers
harness-provider-codex       → orchestrator
infrastructure-provider-local  → orchestrator
validation-provider-local      → orchestrator
scm-provider-github          → orchestrator
work-provider-reef           → core, orchestrator
jira-migrator                → core
web                          → core
```

The architecture gate also rejects cycles, unresolved imports, and production
imports of tests, fixtures, or test helpers.

## Local checks

`pnpm run check` is the contributor-facing non-E2E aggregate. It starts with
the Turbo graph/cache contract and toolchain checks, then runs the discovered
package contract gate, repository lint, typecheck, tests, maintenance, and
release-policy checks:

```bash
pnpm run check:turbo-contract
pnpm run build:packages
pnpm run package-contract:smoke
pnpm run core-git-consumer:smoke
pnpm run architecture:check
pnpm run check
```

The artifact smoke discovers package tarballs from the actual manifests and
`dist/` directories, installs every buildable package in an isolated temporary
consumer with pnpm, and uses only pure Node ESM imports for every public root
and exported subpath plus any discovered CLI bin. It rejects source/TypeScript
files, source exports, and workspace links.
The temporary consumer and its package manager state are removed after the
check.

The separate core Git-consumer smoke creates a local Git snapshot of the
current checkout, installs `packages/core` by commit and `path:` into a fresh
external pnpm project, and imports `createAkbAdapter` from the prepared ESM
artifact. It then removes `node_modules` and repeats the install with
`--frozen-lockfile`. This covers Git-only failure modes—unresolved `catalog:`,
missing `prepare` output, the wrong monorepo subdirectory, and an unpinned
lockfile—without using mutable GitHub `main` or duplicating the tarball smoke.
The fixture approves only the exact package/source/commit/subdirectory selector
through pnpm 11.10's `allowBuilds` policy.
