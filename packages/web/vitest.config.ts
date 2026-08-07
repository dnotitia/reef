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
    setupFiles: ["./vitest.setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/app/api/**/*.test.{ts,tsx}",
            "src/server/**/*.test.{ts,tsx}",
            "scripts/**/*.test.mts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/app/api/**", "src/server/**"],
        },
      },
    ],
  },
});
