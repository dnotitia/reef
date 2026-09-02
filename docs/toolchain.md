# Repository toolchain policy

reef uses one runtime and package-manager baseline across local development,
CI, Docker, and dependency automation. The declarations below are the sources
of truth; generated lockfile entries are derived from them.

| Concern | Source of truth |
| --- | --- |
| Node runtime | Exact execution pin in `.node-version`; support floor in the root `engines.node` |
| pnpm runtime | Root `package.json` `packageManager` |
| Shared workspace versions | The single default `catalog` in `pnpm-workspace.yaml` |
| CI runtime | `node-version-file: .node-version` in active GitHub workflows |
| Container runtime | Docker Node base tags must match the exact `.node-version` pin, with Corepack enabled |
| Dependency updates | `renovate.json` rules for the default catalog, Node, pnpm, and GitHub Actions |
| Enforcement | `pnpm run toolchain:check` |

The default catalog owns the shared versions for `@opentelemetry/api`,
`@types/node`, `tsdown`, `tsx`, `typescript`, `vitest`, and `zod`. The
repository's TypeScript baseline is 6.0.2, declared as `^6.0.2` in the catalog
and normally consumed through `catalog:` by workspaces that run the compiler.
Workspace manifests reference those versions with `catalog:` except for the
Git-prepared package rule below. Internal package edges remain owned by the
consuming package and use `workspace:`; root-only build and analysis tools
remain owned by the root manifest.

The exception is a package with a `prepare` lifecycle that is intentionally
consumable as a pnpm Git dependency. Its manifest must be self-contained outside
the workspace, so it repeats the catalog's concrete ranges. The policy checker
rejects `catalog:` in such a manifest and rejects any repeated range that drifts
from the root source of truth. `@reef/core` is currently the only package with
this contract.

TypeScript 7 is intentionally deferred. TypeScript 7.0 does not yet provide
the stable program API used by the i18n literal scanner and typed lint path.
Revisit the migration only once the TypeScript 7.1 API is stable and the
compiler-dependent tools (including `typescript-eslint`) publish compatible
peer ranges; that decision requires a separate compatibility proof.

The current Node execution pin is `24.18.1`, selected from the supported Node 24
LTS release line. The root `engines.node` value (`>=24.15.0`) remains the
compatible support floor. CI reads `.node-version`, and every root Docker stage
mirrors the same exact Node patch so local, CI, and container test behavior use
one runtime.

The policy checker discovers packages through the repository's existing
workspace discovery helper and rejects direct shared-version declarations,
duplicate root-only tools, Git-prepared package drift, invalid workspace
protocols, unused or named catalogs, and runtime drift. Its normal and negative
regression tests run as part of `pnpm run check`.
