import { describe, expect, it } from "vitest";
import { MIGRATION_ONLY_ENV_KEYS, loadMigrationConfig } from "./config";

describe("migration config", () => {
  it("loads a local AKB endpoint and dedicated service identity", () => {
    expect(
      loadMigrationConfig({
        AKB_BACKEND_URL: "http://127.0.0.1:8000/",
        REEF_AKB_MIGRATION_SERVICE_KEY: "sentinel-key",
        REEF_AKB_MIGRATION_SERVICE_ACCOUNT: "reef-migrator",
      }),
    ).toEqual({
      akbBaseUrl: "http://127.0.0.1:8000",
      serviceKey: "sentinel-key",
      serviceAccount: "reef-migrator",
    });
    expect(MIGRATION_ONLY_ENV_KEYS).toEqual(["REEF_AKB_MIGRATION_SERVICE_KEY"]);
  });

  it.each([
    {},
    {
      AKB_BACKEND_URL: "ftp://akb.internal",
      REEF_AKB_MIGRATION_SERVICE_KEY: "x",
      REEF_AKB_MIGRATION_SERVICE_ACCOUNT: "m",
    },
    {
      AKB_BACKEND_URL: "https://akb.example",
      REEF_AKB_MIGRATION_SERVICE_ACCOUNT: "m",
    },
  ])("fails closed for missing or unsafe configuration", (env) => {
    expect(() => loadMigrationConfig(env)).toThrow("migration_config_invalid");
  });
});
