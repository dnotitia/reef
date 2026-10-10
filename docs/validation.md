# Validation workflow

Use the exact Node version in `.node-version` and pnpm version in the root
`packageManager` in every shell. `docs/toolchain.md` describes the declarations
and policy gate. Run the relevant focused checks during implementation, then
`pnpm run check` and the isolated full E2E suite before opening or updating a PR.

## Focused feedback

Unit tests accept Vitest file and name filters:

```sh
pnpm --filter @reef/web exec vitest run src/features/ui/components/DashboardShell.test.tsx
pnpm --filter @reef/web exec vitest run src/app/api/agents/runs/route.chat.test.ts src/app/api/agents/runs/route.validation.test.ts
pnpm --filter @reef/web run typecheck
pnpm exec biome check packages/web/scripts
```

If an unrelated test fails under a full check, run that file or test name once
in isolation before repeating the full gate. Record the command, runtime,
worker count, input revision and exact failure. The web suite defaults to at
most four workers. `VITEST_MAX_WORKERS` is Vitest's existing override for
environments with several simultaneous validation jobs; Turbo forwards it
through the root check as well as package tests.
Changing a timeout or excluding a failing test does not establish stability.

## Production E2E reuse

The canonical production build records `.next/reef-build.json` with Turbo's
build input hash, Node runtime, platform, architecture and Next build ID. The
hash uses the build dependency graph, lockfile, source files and declared build
environment. Root product version, build configuration and package `.env*`
files are inputs too.
The record is a build output and travels with Turbo cache entries and the
existing production archive.

```sh
pnpm run build
REEF_E2E_SHARDS=1 REEF_E2E_SKIP_BUILD=1 pnpm --filter @reef/web run test:e2e:sharded -- tests/e2e/issues/issue-children-loading.hermetic.spec.ts --repeat-each=3
```

The runner checks provenance before copying standalone assets or starting
Playwright, including when Turbo already supplied the build. Changed inputs,
missing provenance, an overwritten build or a different runtime require a new
canonical build. Direct `next build` does not produce a reusable artifact.
CI also retains its archive SHA-256 and exact commit checks before unpacking.
Do not bypass an input mismatch to diagnose product behavior.

For focused development-server debugging, use the existing single-server
command. It does not reuse a production build:

```sh
pnpm --filter @reef/web run test:e2e tests/e2e/issues/markdown-editor.hermetic.spec.ts --grep 'categorized @ menu' --repeat-each=3
```

The full gate is always:

```sh
pnpm run check
pnpm --filter @reef/web run test:e2e:sharded
```

The local shard runner gives each Playwright process a separate compilation
cache under `packages/web/test-results/transform-cache-{shard}`. This prevents
parallel cold collection from reading another shard's partially written cache
files while retaining cache reuse within each shard.

## Reuse existing fixture behavior

Reset external fixture data with `resetFixture`, then log in through
`openExistingWorkspace`. The shared helpers in `tests/e2e/harness/fixture.ts`
provide list/read/update controls and pending/idle observations. Use those
controls when observing brief loading or mutation states.

- Start an `@` trigger at a valid boundary, such as a new paragraph. The
  categorized-menu test in `issues/markdown-editor.hermetic.spec.ts` shows the
  existing Enter → `@a` flow. Appending `@a` directly to a token does not open
  a mention menu.
- Scope a Retry action to the failing surface. The sub-issue error test in
  `issues/issue-children-loading.hermetic.spec.ts` locates the children error
  region, repairs the fixture, clicks its Retry button and checks loaded rows.
- Register response waits before the action that sends the request. Match
  the exact issue, HTTP method and expected content so an earlier autosave
  cannot satisfy the wait. `harness/issue-content.ts` provides
  `waitForIssueContentSave` for the existing Markdown save flows. Assert
  success and the stored content before
  reloading, then check the reopened UI. The Markdown save round trips show
  this order.

Run a new or changed E2E test focused before the full suite. Use one repetition
for diagnosis and the required repetition count for stability evidence. Keep
public UI actions and stored-result assertions in the spec; fixture controls
only arrange external state.
