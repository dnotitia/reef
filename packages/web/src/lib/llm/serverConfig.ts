import {
  type LLMConfig,
  LLMConfigSchema,
  type LlmAdapter,
  createLlmAdapter,
} from "@reef/core";

export type ServerLlmProvider = "openrouter" | "platform-gateway";

export interface ServerLlmStatus {
  isConfigured: boolean;
  provider: ServerLlmProvider;
  model: string | null;
}

export class ServerLlmConfigError extends Error {
  constructor(readonly issues: string[]) {
    super("server_llm_config_invalid");
    this.name = "ServerLlmConfigError";
  }
}

export function resolveServerLlmConfig(
  env: NodeJS.ProcessEnv = process.env,
):
  | { ok: true; config: LLMConfig; status: ServerLlmStatus }
  | { ok: false; status: ServerLlmStatus; issues: string[] } {
  const governanceMode =
    env.REEF_LLM_GOVERNANCE_MODE?.trim() || "external_metering";
  const hard = governanceMode === "platform_hard";
  const raw = {
    api_key: hard
      ? (env.REEF_LLM_API_KEY?.trim() ?? "")
      : (env.OPENROUTER_API_KEY?.trim() ?? ""),
    base_url: (hard
      ? (env.REEF_LLM_BASE_URL?.trim() ?? "")
      : (env.OPENROUTER_BASE_URL?.trim() ?? "")
    ).replace(/\/+$/, ""),
    model: env.REEF_LLM_MODEL?.trim() ?? "",
    governance_mode: governanceMode,
    platform_gateway_base_url: hard
      ? (env.REEF_PLATFORM_GATEWAY_BASE_URL?.trim() ?? "").replace(/\/+$/, "")
      : null,
  };

  const parsed = LLMConfigSchema.safeParse(raw);
  const managedLegacyCredentialPresent =
    hard &&
    Boolean(env.OPENROUTER_API_KEY?.trim() || env.OPENROUTER_BASE_URL?.trim());
  const status: ServerLlmStatus = {
    isConfigured: parsed.success && !managedLegacyCredentialPresent,
    provider: hard ? "platform-gateway" : "openrouter",
    model: raw.model || null,
  };

  if (!parsed.success || managedLegacyCredentialPresent) {
    return {
      ok: false,
      status: { ...status, isConfigured: false },
      issues: [
        ...(parsed.success
          ? []
          : parsed.error.issues.map((issue) => issue.message)),
        ...(managedLegacyCredentialPresent
          ? ["OPENROUTER_* credentials must be unset in platform_hard mode"]
          : []),
      ],
    };
  }

  return {
    ok: true,
    config: parsed.data,
    status: {
      isConfigured: true,
      provider: status.provider,
      model: parsed.data.model,
    },
  };
}

export function createServerLlmAdapter(config: LLMConfig): LlmAdapter {
  return createLlmAdapter({
    apiKey: config.api_key,
    baseUrl: config.base_url,
    model: config.model,
    governanceMode: config.governance_mode,
  });
}

export function getRequiredServerLlmConfig(
  env: NodeJS.ProcessEnv = process.env,
): LLMConfig {
  const resolved = resolveServerLlmConfig(env);
  if (!resolved.ok) {
    throw new ServerLlmConfigError(resolved.issues);
  }
  return resolved.config;
}
