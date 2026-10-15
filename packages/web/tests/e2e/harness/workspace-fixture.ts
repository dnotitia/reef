import { test as base } from "@playwright/test";
import {
  type FixtureScenario,
  openExistingWorkspace,
  resetFixture,
} from "./fixture";

/** Shared scenario reset; each spec owns its API or login-UI preparation. */
export const test = base.extend<{
  scenario: FixtureScenario;
  openWorkspace: () => Promise<void>;
  resetWorkspace: undefined;
}>({
  scenario: ["configured", { option: true }],
  resetWorkspace: [
    async ({ request, scenario }, use) => {
      await resetFixture(request, scenario);
      await use(undefined);
    },
    { auto: true },
  ],
  openWorkspace: async ({ page }, use) => {
    await use(() => openExistingWorkspace(page));
  },
});
