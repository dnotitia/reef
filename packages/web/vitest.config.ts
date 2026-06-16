import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Worker threads spin up the jsdom environment faster than the default
    // forked processes and share memory, which is the dominant cost in this
    // DOM-heavy suite. The suite is verified green under threads.
    pool: "threads",
    environment: "jsdom",
    // Route Handler tests are server code with no DOM, so they run under the
    // lighter node environment instead of paying for jsdom. Individual non-API
    // logic tests opt in per file with a `// @vitest-environment node` docblock.
    environmentMatchGlobs: [["src/app/api/**", "node"]],
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
