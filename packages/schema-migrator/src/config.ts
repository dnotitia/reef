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
  const configuredBaseUrl = required(env.AKB_BACKEND_URL);
  let parsed: URL;
  try {
    parsed = new URL(configuredBaseUrl);
  } catch {
    throw new MigrationConfigError();
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new MigrationConfigError();
  }
  let baseUrlEnd = configuredBaseUrl.length;
  while (
    baseUrlEnd > 0 &&
    configuredBaseUrl.charCodeAt(baseUrlEnd - 1) === 47
  ) {
    baseUrlEnd -= 1;
  }
  const akbBaseUrl = configuredBaseUrl.slice(0, baseUrlEnd);
  return {
    akbBaseUrl,
    serviceKey: required(env.REEF_AKB_MIGRATION_SERVICE_KEY),
    serviceAccount: required(env.REEF_AKB_MIGRATION_SERVICE_ACCOUNT),
  };
}
