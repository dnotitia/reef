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
`@types/node`, `ai`, `tsx`, `typescript`, `vitest`, and `zod`. Workspace
manifests reference those versions with `catalog:`. Internal package edges
remain owned by the consuming package and use `workspace:`; root-only build
and analysis tools remain owned by the root manifest.

The current Node execution pin is `22.23.2`, selected from the supported Node 22
release line. The root `engines.node` value (`>=22.13.0`) remains the compatible
support floor. CI reads `.node-version`, and every root Docker stage mirrors the
same exact Node patch so local, CI, and container test behavior use one runtime.

The policy checker discovers packages through the repository's existing
workspace discovery helper and rejects direct shared-version declarations,
duplicate root tools, invalid workspace protocols, unused or named catalogs,
and runtime drift. Its normal and negative regression tests run as part of
`pnpm run check`.
