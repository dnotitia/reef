import { defineConfig } from "vitest/config";

/**
 * Live akb contract smoke (REEF-056) — a SEPARATE project from the default
 * `vitest run`, whose `include` is only `src/**`. This config globs the live
 * integration suite under `__tests__/integration/**` so that suite never joins
 * the always-green unit signal. Invoked by `pnpm test:live-akb` on a
 * protected-branch-only CI job; each spec self-skips unless REEF_LIVE_AKB_URL
 * points at a reachable akb.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/integration/**/*.test.ts"],
    restoreMocks: true,
    // A live akb round-trip (create vault, seed, query) is slower than a unit test.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
