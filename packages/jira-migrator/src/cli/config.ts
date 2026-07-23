import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { VaultNameSchema } from "@reef/core";
import { type JiraAuthSecret, jiraAuthHeader } from "../jira/auth.js";
import { redactUnknown } from "../shared/redaction.js";
import { trimTrailingSlashes } from "../shared/url.js";

export type JiraMigratorMode = "dry-run" | "apply";

export interface JiraConfig {
  baseUrl: string;
  cloudId: string;
  /** Compatibility alias for single-project callers. */
  projectKey: string;
  projectKeys: string[];
  boardIds: string[];
  mappingPolicyPaths: Record<string, string>;
  auth: JiraAuthSecret;
}

export interface JiraMigratorConfig {
  mode: JiraMigratorMode;
  /** Compatibility alias retained for existing consumers. */
  dryRun: boolean;
  jira: JiraConfig;
  target: {
    baseUrl: string;
    vault: string;
    jwt: string;
  };
  /** Compatibility aliases retained for existing consumers. */
  targetVault: string;
  reportPath: string | null;
  accountMappingPath: string | null;
  artifacts: {
    runId: string;
    ledgerPath: string | null;
    archiveRoot: string | null;
    accountMappingPath: string | null;
    reportPath: string | null;
  };
  resumeRunId: string | null;
  expectedPlanSha256: string | null;
  control: {
    retryCount: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
  };
}

export interface PublicJiraMigratorConfig {
  mode: JiraMigratorMode;
  jira: {
    baseUrl: string;
    cloudId: string;
    projectKeys: string[];
    boardIds: string[];
    mappingPolicyProjects: string[];
    auth: {
      mode: JiraAuthSecret["mode"];
      isConfigured: true;
      email: string | null;
    };
  };
  target: {
    baseUrl: string;
    vault: string;
    auth: { isConfigured: true };
  };
  artifacts: {
    runId: string;
    ledgerConfigured: boolean;
    archiveConfigured: boolean;
    accountMappingConfigured: boolean;
    reportConfigured: boolean;
  };
  resumeRunId: string | null;
  expectedPlanSha256: string | null;
  control: JiraMigratorConfig["control"];
  reportPath: string | null;
  accountMappingPath: string | null;
}

interface ParsedArgs {
  dryRun: boolean;
  apply: boolean;
  jiraBaseUrl: string | null;
  cloudId: string | null;
  projectKeys: string[];
  boardIds: string[];
  mappingPolicies: string[];
  vault: string | null;
  akbBaseUrl: string | null;
  reportPath: string | null;
  ledgerPath: string | null;
  archiveRoot: string | null;
  accountMappingPath: string | null;
  runId: string | null;
  resumeRunId: string | null;
  expectedPlanSha256: string | null;
  retryCount: string | null;
  retryBaseDelayMs: string | null;
  retryMaxDelayMs: string | null;
  apiTokenFile: string | null;
  bearerTokenFile: string | null;
  akbJwtFile: string | null;
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

const valueAt = (
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

const valueFromEquals = (arg: string, flag: string): string | null =>
  arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : null;

const emptyParsedArgs = (): ParsedArgs => ({
  dryRun: false,
  apply: false,
  jiraBaseUrl: null,
  cloudId: null,
  projectKeys: [],
  boardIds: [],
  mappingPolicies: [],
  vault: null,
  akbBaseUrl: null,
  reportPath: null,
  ledgerPath: null,
  archiveRoot: null,
  accountMappingPath: null,
  runId: null,
  resumeRunId: null,
  expectedPlanSha256: null,
  retryCount: null,
  retryBaseDelayMs: null,
  retryMaxDelayMs: null,
  apiTokenFile: null,
  bearerTokenFile: null,
  akbJwtFile: null,
});

const singleFlags: Record<
  string,
  Exclude<
    keyof ParsedArgs,
    "dryRun" | "apply" | "projectKeys" | "boardIds" | "mappingPolicies"
  >
> = {
  "--jira-base-url": "jiraBaseUrl",
  "--jira-cloud-id": "cloudId",
  "--vault": "vault",
  "--akb-base-url": "akbBaseUrl",
  "--report": "reportPath",
  "--report-path": "reportPath",
  "--ledger-path": "ledgerPath",
  "--archive-root": "archiveRoot",
  "--account-mapping": "accountMappingPath",
  "--account-mapping-path": "accountMappingPath",
  "--run-id": "runId",
  "--resume": "resumeRunId",
  "--expected-plan-sha256": "expectedPlanSha256",
  "--retry-count": "retryCount",
  "--retry-base-delay-ms": "retryBaseDelayMs",
  "--retry-max-delay-ms": "retryMaxDelayMs",
  "--api-token-file": "apiTokenFile",
  "--bearer-token-file": "bearerTokenFile",
  "--akb-jwt-file": "akbJwtFile",
};

export function parseJiraMigratorArgs(argv: readonly string[]): ParsedArgs {
  const parsed = emptyParsedArgs();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }
    const repeated = [
      ["--project-key", "projectKeys"],
      ["--board-id", "boardIds"],
      ["--mapping-policy", "mappingPolicies"],
    ] as const;
    let matched = false;
    for (const [flag, key] of repeated) {
      if (arg === flag) {
        parsed[key].push(valueAt(argv, index, flag));
        index += 1;
        matched = true;
        break;
      }
      const inline = arg ? valueFromEquals(arg, flag) : null;
      if (inline !== null) {
        if (!inline)
          throw new JiraMigratorConfigError([`${flag} requires a value`]);
        parsed[key].push(inline);
        matched = true;
        break;
      }
    }
    if (matched) continue;
    for (const [flag, key] of Object.entries(singleFlags)) {
      if (arg === flag) {
        parsed[key] = valueAt(argv, index, flag);
        index += 1;
        matched = true;
        break;
      }
      const inline = arg ? valueFromEquals(arg, flag) : null;
      if (inline !== null) {
        if (!inline)
          throw new JiraMigratorConfigError([`${flag} requires a value`]);
        parsed[key] = inline;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const optionName = arg?.startsWith("-")
        ? arg.split("=", 1)[0]
        : undefined;
      throw new JiraMigratorConfigError([
        optionName ? `Unknown argument: ${optionName}` : "Unknown argument",
      ]);
    }
  }
  return parsed;
}

const parseHttpsUrl = (candidate: string | null, label: string): string => {
  if (!candidate) throw new JiraMigratorConfigError([`${label} is required`]);
  try {
    const normalized = candidate.trim().replace(/[\t\n\r]/gu, "");
    const url = new URL(normalized);
    const authority = normalized
      .replace(/^https:/iu, "")
      .replaceAll("\\", "/")
      .replace(/^\/+/, "")
      .split(/[/?#]/u, 1)[0];
    if (
      url.protocol !== "https:" ||
      authority?.includes("@") ||
      url.username ||
      url.password
    ) {
      throw new Error("unsafe_url");
    }
    url.pathname = trimTrailingSlashes(url.pathname);
    url.search = "";
    url.hash = "";
    return trimTrailingSlashes(url.toString());
  } catch {
    throw new JiraMigratorConfigError([`${label} must be a valid HTTPS URL`]);
  }
};

const parseProjectKey = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]+$/u.test(normalized)) {
    throw new JiraMigratorConfigError([
      "Jira project key must contain uppercase letters, digits, or underscores",
    ]);
  }
  return normalized;
};

const parseProjects = (
  parsed: ParsedArgs,
  env: Record<string, string | undefined>,
): string[] => {
  const values =
    parsed.projectKeys.length > 0
      ? parsed.projectKeys
      : [firstValue(env.REEF_JIRA_PROJECT_KEY, env.JIRA_PROJECT_KEY)].filter(
          (value): value is string => value !== null,
        );
  if (values.length === 0) {
    throw new JiraMigratorConfigError([
      "REEF_JIRA_PROJECT_KEY or --project-key is required",
    ]);
  }
  return [...new Set(values.map(parseProjectKey))].sort();
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

const readPrivateSecretFile = (path: string, label: string): string => {
  try {
    const stat = lstatSync(path);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    ) {
      throw new Error("unsafe_secret_file");
    }
    const value = readFileSync(path, "utf8").trim();
    if (value) return value;
  } catch {
    // Fall through to the generic, value-safe error.
  }
  throw new JiraMigratorConfigError([
    `${label} secret file must be a private regular file`,
  ]);
};

const resolveSecret = (
  envValue: string | null,
  filePath: string | null,
  label: string,
): string | null => {
  if (envValue && filePath) {
    throw new JiraMigratorConfigError([
      `${label} must use either environment or secret file, not both`,
    ]);
  }
  if (envValue) return envValue;
  if (filePath) return readPrivateSecretFile(filePath, label);
  return null;
};

const resolveJiraAuth = (
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
  if (bearerToken) return { mode: "bearer", token: bearerToken };
  if (email && apiToken) return { mode: "basic", email, apiToken };
  throw new JiraMigratorConfigError([
    "Jira credentials are required via environment variables or local secret files",
  ]);
};

const parseMode = (parsed: ParsedArgs): JiraMigratorMode => {
  if (Number(parsed.dryRun) + Number(parsed.apply) !== 1) {
    throw new JiraMigratorConfigError([
      "Exactly one of --dry-run or --apply is required",
    ]);
  }
  return parsed.dryRun ? "dry-run" : "apply";
};

const parseSha256 = (
  value: string | null,
  mode: JiraMigratorMode,
): string | null => {
  if (mode === "apply" && !value) {
    throw new JiraMigratorConfigError([
      "--expected-plan-sha256 is required with --apply",
    ]);
  }
  if (value && !/^[a-f0-9]{64}$/u.test(value)) {
    throw new JiraMigratorConfigError([
      "--expected-plan-sha256 must be a lowercase SHA-256",
    ]);
  }
  return value;
};

const parseInteger = (
  raw: string | null,
  fallback: number,
  label: string,
  minimum: number,
): number => {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new JiraMigratorConfigError([
      `${label} must be an integer >= ${minimum}`,
    ]);
  }
  return value;
};

const parseMappingPolicies = (
  values: readonly string[],
  projects: readonly string[],
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator < 1 || separator === value.length - 1) {
      throw new JiraMigratorConfigError([
        "--mapping-policy must use PROJECT=/path/to/policy.json",
      ]);
    }
    const project = parseProjectKey(value.slice(0, separator));
    if (!projects.includes(project)) {
      throw new JiraMigratorConfigError([
        `Mapping policy project ${project} is outside configured project scope`,
      ]);
    }
    if (result[project]) {
      throw new JiraMigratorConfigError([
        `Mapping policy for ${project} was provided more than once`,
      ]);
    }
    result[project] = value.slice(separator + 1);
  }
  return result;
};

const approvalRunId = (reportPath: string | null): string | null => {
  if (!reportPath) return null;
  try {
    const parsed = JSON.parse(
      readFileSync(`${reportPath}.approval.json`, "utf8"),
    ) as {
      run?: { run_id?: unknown; mode?: unknown };
    };
    return parsed.run?.mode === "dry-run" &&
      typeof parsed.run.run_id === "string" &&
      parsed.run.run_id.length > 0
      ? parsed.run.run_id
      : null;
  } catch {
    return null;
  }
};

export function loadJiraMigratorConfig({
  argv = [],
  env = process.env,
}: LoadJiraMigratorConfigOptions = {}): JiraMigratorConfig {
  const parsed = parseJiraMigratorArgs(argv);
  const mode = parseMode(parsed);
  const cloudId = firstValue(
    parsed.cloudId,
    env.REEF_JIRA_CLOUD_ID,
    env.JIRA_CLOUD_ID,
  );
  if (!cloudId) {
    throw new JiraMigratorConfigError([
      "REEF_JIRA_CLOUD_ID or --jira-cloud-id is required",
    ]);
  }
  const projectKeys = parseProjects(parsed, env);
  const vault = parseVault(
    firstValue(
      parsed.vault,
      env.REEF_JIRA_MIGRATOR_VAULT,
      env.REEF_ORCHESTRATOR_VAULT,
      env.REEF_VAULT,
    ),
  );
  const reportPath = firstValue(
    parsed.reportPath,
    env.REEF_JIRA_MIGRATOR_REPORT_PATH,
  );
  const accountMappingPath = firstValue(
    parsed.accountMappingPath,
    env.REEF_JIRA_ACCOUNT_MAPPING_PATH,
  );
  const resumeRunId = firstValue(parsed.resumeRunId);
  const explicitRunId = resumeRunId ?? firstValue(parsed.runId);
  const recoveredRunId =
    mode === "apply" && firstValue(parsed.expectedPlanSha256)
      ? approvalRunId(reportPath)
      : null;
  if (
    mode === "apply" &&
    firstValue(parsed.expectedPlanSha256) &&
    !explicitRunId &&
    !recoveredRunId
  ) {
    throw new JiraMigratorConfigError([
      "--run-id is required with --apply when no sealed approval report is available",
    ]);
  }
  const runId = explicitRunId ?? recoveredRunId ?? randomUUID();
  const targetJwt = resolveSecret(
    firstValue(env.REEF_AKB_JWT),
    firstValue(parsed.akbJwtFile, env.REEF_AKB_JWT_FILE),
    "AKB JWT",
  );
  if (!targetJwt) {
    throw new JiraMigratorConfigError([
      "REEF_AKB_JWT or --akb-jwt-file is required",
    ]);
  }
  const retryCount = parseInteger(
    firstValue(parsed.retryCount, env.REEF_JIRA_RETRY_COUNT),
    3,
    "retry count",
    0,
  );
  const retryBaseDelayMs = parseInteger(
    firstValue(parsed.retryBaseDelayMs, env.REEF_JIRA_RETRY_BASE_DELAY_MS),
    250,
    "retry base delay",
    0,
  );
  const retryMaxDelayMs = parseInteger(
    firstValue(parsed.retryMaxDelayMs, env.REEF_JIRA_RETRY_MAX_DELAY_MS),
    10_000,
    "retry max delay",
    0,
  );
  if (retryMaxDelayMs < retryBaseDelayMs) {
    throw new JiraMigratorConfigError([
      "retry max delay must be greater than or equal to retry base delay",
    ]);
  }
  return {
    mode,
    dryRun: mode === "dry-run",
    jira: {
      baseUrl: parseHttpsUrl(
        firstValue(
          parsed.jiraBaseUrl,
          env.REEF_JIRA_BASE_URL,
          env.JIRA_BASE_URL,
          `https://api.atlassian.com/ex/jira/${cloudId}`,
        ),
        "Jira base URL",
      ),
      cloudId,
      projectKey: projectKeys[0] as string,
      projectKeys,
      boardIds: [...new Set(parsed.boardIds.map((value) => value.trim()))]
        .filter(Boolean)
        .sort((left, right) =>
          left.localeCompare(right, "en", { numeric: true }),
        ),
      mappingPolicyPaths: parseMappingPolicies(
        parsed.mappingPolicies,
        projectKeys,
      ),
      auth: resolveJiraAuth(env, parsed),
    },
    target: {
      baseUrl: parseHttpsUrl(
        firstValue(parsed.akbBaseUrl, env.AKB_BACKEND_URL),
        "AKB base URL",
      ),
      vault,
      jwt: targetJwt,
    },
    targetVault: vault,
    reportPath,
    accountMappingPath,
    artifacts: {
      runId,
      ledgerPath: firstValue(parsed.ledgerPath, env.REEF_JIRA_LEDGER_PATH),
      archiveRoot: firstValue(parsed.archiveRoot, env.REEF_JIRA_ARCHIVE_ROOT),
      accountMappingPath,
      reportPath,
    },
    resumeRunId,
    expectedPlanSha256: parseSha256(
      firstValue(parsed.expectedPlanSha256),
      mode,
    ),
    control: { retryCount, retryBaseDelayMs, retryMaxDelayMs },
  };
}

export function publicJiraMigratorConfig(
  config: JiraMigratorConfig,
): PublicJiraMigratorConfig {
  return {
    mode: config.mode,
    jira: {
      baseUrl: config.jira.baseUrl,
      cloudId: config.jira.cloudId,
      projectKeys: [...config.jira.projectKeys],
      boardIds: [...config.jira.boardIds],
      mappingPolicyProjects: Object.keys(config.jira.mappingPolicyPaths).sort(),
      auth: {
        mode: config.jira.auth.mode,
        isConfigured: true,
        email:
          config.jira.auth.mode === "basic" ? config.jira.auth.email : null,
      },
    },
    target: {
      baseUrl: config.target.baseUrl,
      vault: config.target.vault,
      auth: { isConfigured: true },
    },
    artifacts: {
      runId: config.artifacts.runId,
      ledgerConfigured: config.artifacts.ledgerPath !== null,
      archiveConfigured: config.artifacts.archiveRoot !== null,
      accountMappingConfigured: config.artifacts.accountMappingPath !== null,
      reportConfigured: config.artifacts.reportPath !== null,
    },
    resumeRunId: config.resumeRunId,
    expectedPlanSha256: config.expectedPlanSha256,
    control: { ...config.control },
    reportPath: config.reportPath,
    accountMappingPath: config.accountMappingPath,
  };
}

export function secretValuesForConfig(config: JiraMigratorConfig): string[] {
  const authHeader = jiraAuthHeader(config.jira.auth);
  const jiraSecrets =
    config.jira.auth.mode === "bearer"
      ? [config.jira.auth.token]
      : [config.jira.auth.apiToken];
  return [
    ...jiraSecrets,
    authHeader,
    config.target.jwt,
    `Bearer ${config.target.jwt}`,
  ];
}

export function redactForConfig<T>(config: JiraMigratorConfig, value: T): T {
  return redactUnknown(value, secretValuesForConfig(config));
}
