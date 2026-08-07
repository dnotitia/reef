/**
 * Vitest config for the LLM eval suite.
 *
 * Separate from the main vitest.config.ts to avoid running evals in every `pnpm test`.
 * Run with: pnpm --filter @reef/web exec vitest run --config vitest.eval.ts
 *
 * The current suite is fixture-backed. Real LLM calls are a separate live
 * boundary and are not part of this hermetic command.
 */
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@reef/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/evals/**/*.eval.ts"],
    reporters: ["verbose"],
    testTimeout: 60000,
  },
});
