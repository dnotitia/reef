import {
  type GitHubAppConfig,
  GitHubAppConfigSchema,
  type LLMConfig,
  LLMConfigSchema,
  VaultNameSchema,
} from "@reef/core";

export const DEFAULT_POLL_INTERVAL_MS = 30_000;
export const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

export type OrchestratorMode = "dry-run" | "idle";

export interface OrchestratorConfig {
  mode: OrchestratorMode;
  dryRun: boolean;
  vault: string;
  pollIntervalMs: number;
  shutdownGraceMs: number;
  akbBaseUrl: string | null;
  llm: LLMConfig | null;
  githubApp: GitHubAppConfig | null;
}

export interface PublicOrchestratorConfig {
  mode: OrchestratorMode;
  dryRun: boolean;
  vault: string;
  pollIntervalMs: number;
  shutdownGraceMs: number;
  akb: {
    isConfigured: boolean;
  };
  llm: {
    isConfigured: boolean;
    model: string | null;
  };
  githubApp: {
    isConfigured: boolean;
    appId: string | null;
  };
}

export interface LoadOrchestratorConfigOptions {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
}

interface ParsedArgs {
  dryRun: boolean;
  vault: string | null;
  pollIntervalMs: string | null;
  shutdownGraceMs: string | null;
}

export class OrchestratorConfigError extends Error {
  constructor(readonly issues: string[]) {
    super("orchestrator_config_invalid");
    this.name = "OrchestratorConfigError";
  }
}

const trimToNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const parseBooleanEnv = (value: string | undefined): boolean | null => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new OrchestratorConfigError([
    `Invalid boolean value for REEF_ORCHESTRATOR_DRY_RUN: ${value}`,
  ]);
};

const parsePositiveInteger = (
  raw: string | null,
  fallback: number,
  field: string,
): number => {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new OrchestratorConfigError([
      `${field} must be a positive integer number of milliseconds`,
    ]);
  }
  return value;
};

const readFlagValue = (
  argv: readonly string[],
  index: number,
  flag: string,
): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new OrchestratorConfigError([`${flag} requires a value`]);
  }
  return value;
};

export function parseOrchestratorArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    dryRun: false,
    vault: null,
    pollIntervalMs: null,
    shutdownGraceMs: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
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
    if (arg === "--poll-interval-ms") {
      parsed.pollIntervalMs = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--poll-interval-ms=")) {
      parsed.pollIntervalMs = arg.slice("--poll-interval-ms=".length);
      continue;
    }
    if (arg === "--shutdown-grace-ms") {
      parsed.shutdownGraceMs = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--shutdown-grace-ms=")) {
      parsed.shutdownGraceMs = arg.slice("--shutdown-grace-ms=".length);
      continue;
    }

    throw new OrchestratorConfigError([`Unknown argument: ${arg}`]);
  }

  return parsed;
}

const normalizePrivateKey = (raw: string | undefined): string =>
  (raw ?? "").replace(/\\n/g, "\n").trim();

const resolveOptionalLlmConfig = (
  env: Record<string, string | undefined>,
): LLMConfig | null => {
  const canonicalApiKey = trimToNull(env.REEF_LLM_API_KEY);
  const legacyApiKey = trimToNull(env.OPENROUTER_API_KEY);
  const canonicalBaseUrl = trimToNull(env.REEF_LLM_BASE_URL);
  const legacyBaseUrl = trimToNull(env.OPENROUTER_BASE_URL);
  const aliasConflicts = [
    canonicalApiKey && legacyApiKey && canonicalApiKey !== legacyApiKey
      ? "REEF_LLM_API_KEY and its OPENROUTER_API_KEY alias must not disagree"
      : null,
    canonicalBaseUrl &&
    legacyBaseUrl &&
    canonicalBaseUrl.replace(/\/+$/, "") !== legacyBaseUrl.replace(/\/+$/, "")
      ? "REEF_LLM_BASE_URL and its OPENROUTER_BASE_URL alias must not disagree"
      : null,
  ].filter((issue): issue is string => issue !== null);
  if (aliasConflicts.length > 0) {
    throw new OrchestratorConfigError(aliasConflicts);
  }

  const raw = {
    api_key: canonicalApiKey ?? legacyApiKey ?? "",
    base_url: canonicalBaseUrl ?? legacyBaseUrl ?? "",
    model: trimToNull(env.REEF_LLM_MODEL) ?? "",
  };
  const configuredCount = Object.values(raw).filter(
    (value) => value.length > 0,
  ).length;
  if (configuredCount === 0) return null;
  if (configuredCount !== Object.keys(raw).length) {
    throw new OrchestratorConfigError([
      "REEF_LLM_API_KEY, REEF_LLM_BASE_URL, and REEF_LLM_MODEL must be set together",
    ]);
  }

  const parsed = LLMConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrchestratorConfigError(
      parsed.error.issues.map((issue) => issue.message),
    );
  }
  return parsed.data;
};

const resolveOptionalGitHubAppConfig = (
  env: Record<string, string | undefined>,
): GitHubAppConfig | null => {
  const raw = {
    app_id: trimToNull(env.REEF_GITHUB_APP_ID) ?? "",
    installation_id: trimToNull(env.REEF_GITHUB_APP_INSTALLATION_ID) ?? "",
    private_key: normalizePrivateKey(env.REEF_GITHUB_APP_PRIVATE_KEY),
  };
  const allConfigured = Object.values(raw).every((value) => value.length > 0);
  if (!allConfigured) return null;

  const parsed = GitHubAppConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrchestratorConfigError(
      parsed.error.issues.map((issue) => issue.message),
    );
  }
  return parsed.data;
};

export function loadOrchestratorConfig({
  argv = [],
  env = process.env,
}: LoadOrchestratorConfigOptions = {}): OrchestratorConfig {
  const parsedArgs = parseOrchestratorArgs(argv);
  const envDryRun = parseBooleanEnv(env.REEF_ORCHESTRATOR_DRY_RUN);
  const dryRun = parsedArgs.dryRun || envDryRun === true;
  const vaultCandidate =
    trimToNull(parsedArgs.vault ?? undefined) ??
    trimToNull(env.REEF_ORCHESTRATOR_VAULT) ??
    trimToNull(env.REEF_VAULT);

  if (!vaultCandidate) {
    throw new OrchestratorConfigError([
      "REEF_ORCHESTRATOR_VAULT or --vault is required",
    ]);
  }

  const vaultParsed = VaultNameSchema.safeParse(vaultCandidate);
  if (!vaultParsed.success) {
    throw new OrchestratorConfigError(
      vaultParsed.error.issues.map((issue) => issue.message),
    );
  }

  return {
    mode: dryRun ? "dry-run" : "idle",
    dryRun,
    vault: vaultParsed.data,
    pollIntervalMs: parsePositiveInteger(
      parsedArgs.pollIntervalMs ??
        trimToNull(env.REEF_ORCHESTRATOR_POLL_INTERVAL_MS),
      DEFAULT_POLL_INTERVAL_MS,
      "pollIntervalMs",
    ),
    shutdownGraceMs: parsePositiveInteger(
      parsedArgs.shutdownGraceMs ??
        trimToNull(env.REEF_ORCHESTRATOR_SHUTDOWN_GRACE_MS),
      DEFAULT_SHUTDOWN_GRACE_MS,
      "shutdownGraceMs",
    ),
    akbBaseUrl:
      trimToNull(env.REEF_AKB_BASE_URL) ?? trimToNull(env.AKB_BASE_URL),
    llm: resolveOptionalLlmConfig(env),
    githubApp: resolveOptionalGitHubAppConfig(env),
  };
}

export function publicOrchestratorConfig(
  config: OrchestratorConfig,
): PublicOrchestratorConfig {
  return {
    mode: config.mode,
    dryRun: config.dryRun,
    vault: config.vault,
    pollIntervalMs: config.pollIntervalMs,
    shutdownGraceMs: config.shutdownGraceMs,
    akb: {
      isConfigured: config.akbBaseUrl !== null,
    },
    llm: {
      isConfigured: config.llm !== null,
      model: config.llm?.model ?? null,
    },
    githubApp: {
      isConfigured: config.githubApp !== null,
      appId: config.githubApp?.app_id ?? null,
    },
  };
}
