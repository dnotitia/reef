export const MIGRATION_ONLY_ENV_KEYS = Object.freeze([
  "REEF_AKB_MIGRATION_SERVICE_KEY",
] as const);

export interface MigrationConfig {
  akbBaseUrl: string;
  serviceKey: string;
  serviceAccount: string;
}

export class MigrationConfigError extends Error {
  constructor() {
    super("migration_config_invalid");
    this.name = "MigrationConfigError";
  }
}

const required = (value: string | undefined): string => {
  const trimmed = value?.trim();
  if (!trimmed) throw new MigrationConfigError();
  return trimmed;
};

export function loadMigrationConfig(
  env: Record<string, string | undefined> = process.env,
): MigrationConfig {
  const akbBaseUrl = required(env.AKB_BACKEND_URL).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(akbBaseUrl);
  } catch {
    throw new MigrationConfigError();
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new MigrationConfigError();
  }
  return {
    akbBaseUrl,
    serviceKey: required(env.REEF_AKB_MIGRATION_SERVICE_KEY),
    serviceAccount: required(env.REEF_AKB_MIGRATION_SERVICE_ACCOUNT),
  };
}
