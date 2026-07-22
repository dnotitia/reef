import { readFileSync } from "node:fs";
import { VaultNameSchema } from "@reef/core";
import { type JiraAuthSecret, jiraAuthHeader } from "../jira/auth.js";
import { redactUnknown } from "../shared/redaction.js";
import { trimTrailingSlashes } from "../shared/url.js";

export interface JiraConfig {
  baseUrl: string;
  cloudId: string | null;
  projectKey: string;
  auth: JiraAuthSecret;
}

export interface JiraMigratorConfig {
  dryRun: boolean;
  jira: JiraConfig;
  targetVault: string;
  reportPath: string | null;
  accountMappingPath: string | null;
}

export interface PublicJiraMigratorConfig {
  dryRun: boolean;
  jira: {
    baseUrl: string;
    cloudId: string | null;
    projectKey: string;
    auth: {
      mode: JiraAuthSecret["mode"];
      isConfigured: true;
      email: string | null;
    };
  };
  targetVault: string;
  reportPath: string | null;
  accountMappingPath: string | null;
}

interface ParsedArgs {
  dryRun: boolean;
  jiraBaseUrl: string | null;
  cloudId: string | null;
  projectKey: string | null;
  vault: string | null;
  reportPath: string | null;
  accountMappingPath: string | null;
  apiTokenFile: string | null;
  bearerTokenFile: string | null;
}

export interface LoadJiraMigratorConfigOptions {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
}

export class JiraMigratorConfigError extends Error {
  constructor(readonly issues: string[]) {
    super("jira_migrator_config_invalid");
    this.name = "JiraMigratorConfigError";
  }
}

const trimToNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const firstValue = (
  ...values: Array<string | null | undefined>
): string | null => {
  for (const value of values) {
    const trimmed = trimToNull(value ?? undefined);
    if (trimmed) return trimmed;
  }
  return null;
};

const readFlagValue = (
  argv: readonly string[],
  index: number,
  flag: string,
): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new JiraMigratorConfigError([`${flag} requires a value`]);
  }
  return value;
};

const parseBooleanEnv = (value: string | undefined): boolean | null => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new JiraMigratorConfigError([
    "REEF_JIRA_MIGRATOR_DRY_RUN must be a boolean value",
  ]);
};

export function parseJiraMigratorArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    dryRun: false,
    jiraBaseUrl: null,
    cloudId: null,
    projectKey: null,
    vault: null,
    reportPath: null,
    accountMappingPath: null,
    apiTokenFile: null,
    bearerTokenFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--jira-base-url") {
      parsed.jiraBaseUrl = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--jira-base-url=")) {
      parsed.jiraBaseUrl = arg.slice("--jira-base-url=".length);
      continue;
    }
    if (arg === "--jira-cloud-id") {
      parsed.cloudId = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--jira-cloud-id=")) {
      parsed.cloudId = arg.slice("--jira-cloud-id=".length);
      continue;
    }
    if (arg === "--project-key") {
      parsed.projectKey = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--project-key=")) {
      parsed.projectKey = arg.slice("--project-key=".length);
      continue;
    }
    if (arg === "--vault") {
      parsed.vault = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--vault=")) {
      parsed.vault = arg.slice("--vault=".length);
      continue;
    }
    if (arg === "--report") {
      parsed.reportPath = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--report=")) {
      parsed.reportPath = arg.slice("--report=".length);
      continue;
    }
    if (arg === "--account-mapping") {
      parsed.accountMappingPath = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--account-mapping=")) {
      parsed.accountMappingPath = arg.slice("--account-mapping=".length);
      continue;
    }
    if (arg === "--api-token-file") {
      parsed.apiTokenFile = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--api-token-file=")) {
      parsed.apiTokenFile = arg.slice("--api-token-file=".length);
      continue;
    }
    if (arg === "--bearer-token-file") {
      parsed.bearerTokenFile = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--bearer-token-file=")) {
      parsed.bearerTokenFile = arg.slice("--bearer-token-file=".length);
      continue;
    }

    throw new JiraMigratorConfigError([`Unknown argument: ${arg}`]);
  }

  return parsed;
}

const parseBaseUrl = (raw: string | null, cloudId: string | null): string => {
  const candidate =
    raw ?? (cloudId ? `https://api.atlassian.com/ex/jira/${cloudId}` : null);
  if (!candidate) {
    throw new JiraMigratorConfigError([
      "REEF_JIRA_BASE_URL, JIRA_BASE_URL, or REEF_JIRA_CLOUD_ID is required",
    ]);
  }

  try {
    const normalizedCandidate = candidate.trim().replace(/[\t\n\r]/gu, "");
    const url = new URL(normalizedCandidate);
    if (url.protocol !== "https:") {
      throw new Error("non_https");
    }
    const authority = normalizedCandidate
      .replace(/^https:/iu, "")
      .replaceAll("\\", "/")
      .replace(/^\/+/, "")
      .split(/[/?#]/u, 1)[0];
    if (authority?.includes("@")) {
      throw new Error("userinfo_not_allowed");
    }
    if (url.username || url.password) {
      throw new Error("userinfo_not_allowed");
    }
    url.pathname = trimTrailingSlashes(url.pathname);
    url.search = "";
    url.hash = "";
    return trimTrailingSlashes(url.toString());
  } catch {
    throw new JiraMigratorConfigError([
      "Jira base URL must be a valid HTTPS URL",
    ]);
  }
};

const parseProjectKey = (value: string | null): string => {
  if (!value) {
    throw new JiraMigratorConfigError([
      "REEF_JIRA_PROJECT_KEY or --project-key is required",
    ]);
  }
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]+$/.test(normalized)) {
    throw new JiraMigratorConfigError([
      "Jira project key must contain uppercase letters, digits, or underscores",
    ]);
  }
  return normalized;
};

const parseVault = (value: string | null): string => {
  if (!value) {
    throw new JiraMigratorConfigError([
      "REEF_JIRA_MIGRATOR_VAULT, REEF_VAULT, or --vault is required",
    ]);
  }
  const parsed = VaultNameSchema.safeParse(value);
  if (!parsed.success) {
    throw new JiraMigratorConfigError(
      parsed.error.issues.map((issue) => issue.message),
    );
  }
  return parsed.data;
};

const readSecretFile = (path: string, label: string): string => {
  try {
    const value = readFileSync(path, "utf8").trim();
    if (value) return value;
  } catch {
    // Fall through to the generic, value-safe error below.
  }
  throw new JiraMigratorConfigError([`${label} secret file could not be read`]);
};

const resolveSecret = (
  envValue: string | null,
  filePath: string | null,
  label: string,
): string | null => {
  if (envValue) return envValue;
  if (filePath) return readSecretFile(filePath, label);
  return null;
};

const resolveAuth = (
  env: Record<string, string | undefined>,
  parsed: ParsedArgs,
): JiraAuthSecret => {
  const email = firstValue(env.REEF_JIRA_EMAIL, env.JIRA_EMAIL);
  const apiToken = resolveSecret(
    firstValue(env.REEF_JIRA_API_TOKEN, env.JIRA_API_TOKEN),
    firstValue(
      parsed.apiTokenFile,
      env.REEF_JIRA_API_TOKEN_FILE,
      env.JIRA_API_TOKEN_FILE,
    ),
    "Jira API token",
  );
  const bearerToken = resolveSecret(
    firstValue(env.REEF_JIRA_BEARER_TOKEN, env.JIRA_BEARER_TOKEN),
    firstValue(
      parsed.bearerTokenFile,
      env.REEF_JIRA_BEARER_TOKEN_FILE,
      env.JIRA_BEARER_TOKEN_FILE,
    ),
    "Jira bearer token",
  );

  if (bearerToken && (email || apiToken)) {
    throw new JiraMigratorConfigError([
      "Configure either Jira bearer auth or Jira basic auth, not both",
    ]);
  }
  if (bearerToken) {
    return { mode: "bearer", token: bearerToken };
  }
  if (email && apiToken) {
    return { mode: "basic", email, apiToken };
  }

  throw new JiraMigratorConfigError([
    "Jira credentials are required via environment variables or local secret files",
  ]);
};

export function loadJiraMigratorConfig({
  argv = [],
  env = process.env,
}: LoadJiraMigratorConfigOptions = {}): JiraMigratorConfig {
  const parsed = parseJiraMigratorArgs(argv);
  const cloudId = firstValue(
    parsed.cloudId,
    env.REEF_JIRA_CLOUD_ID,
    env.JIRA_CLOUD_ID,
  );
  const dryRun =
    parsed.dryRun || parseBooleanEnv(env.REEF_JIRA_MIGRATOR_DRY_RUN) === true;

  return {
    dryRun,
    jira: {
      baseUrl: parseBaseUrl(
        firstValue(
          parsed.jiraBaseUrl,
          env.REEF_JIRA_BASE_URL,
          env.JIRA_BASE_URL,
        ),
        cloudId,
      ),
      cloudId,
      projectKey: parseProjectKey(
        firstValue(
          parsed.projectKey,
          env.REEF_JIRA_PROJECT_KEY,
          env.JIRA_PROJECT_KEY,
        ),
      ),
      auth: resolveAuth(env, parsed),
    },
    targetVault: parseVault(
      firstValue(
        parsed.vault,
        env.REEF_JIRA_MIGRATOR_VAULT,
        env.REEF_ORCHESTRATOR_VAULT,
        env.REEF_VAULT,
      ),
    ),
    reportPath: firstValue(
      parsed.reportPath,
      env.REEF_JIRA_MIGRATOR_REPORT_PATH,
    ),
    accountMappingPath: firstValue(
      parsed.accountMappingPath,
      env.REEF_JIRA_ACCOUNT_MAPPING_PATH,
    ),
  };
}

export function publicJiraMigratorConfig(
  config: JiraMigratorConfig,
): PublicJiraMigratorConfig {
  return {
    dryRun: config.dryRun,
    jira: {
      baseUrl: config.jira.baseUrl,
      cloudId: config.jira.cloudId,
      projectKey: config.jira.projectKey,
      auth: {
        mode: config.jira.auth.mode,
        isConfigured: true,
        email:
          config.jira.auth.mode === "basic" ? config.jira.auth.email : null,
      },
    },
    targetVault: config.targetVault,
    reportPath: config.reportPath,
    accountMappingPath: config.accountMappingPath,
  };
}

export function secretValuesForConfig(config: JiraMigratorConfig): string[] {
  const authHeader = jiraAuthHeader(config.jira.auth);
  if (config.jira.auth.mode === "bearer") {
    return [config.jira.auth.token, authHeader];
  }
  return [config.jira.auth.apiToken, authHeader];
}

export function redactForConfig<T>(config: JiraMigratorConfig, value: T): T {
  return redactUnknown(value, secretValuesForConfig(config));
}
