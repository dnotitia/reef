import { type LLMConfig, LLMConfigSchema } from "@reef/core";

export const SERVER_LLM_PROVIDER = "openrouter" as const;

export interface ServerLlmStatus {
  isConfigured: boolean;
  provider: typeof SERVER_LLM_PROVIDER;
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
  const raw = {
    api_key: env.OPENROUTER_API_KEY?.trim() ?? "",
    base_url: env.OPENROUTER_BASE_URL?.trim() ?? "",
    model: env.REEF_LLM_MODEL?.trim() ?? "",
  };

  const parsed = LLMConfigSchema.safeParse(raw);
  const status: ServerLlmStatus = {
    isConfigured: parsed.success,
    provider: SERVER_LLM_PROVIDER,
    model: raw.model || null,
  };

  if (!parsed.success) {
    return {
      ok: false,
      status: { ...status, isConfigured: false },
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }

  return {
    ok: true,
    config: parsed.data,
    status: {
      isConfigured: true,
      provider: SERVER_LLM_PROVIDER,
      model: parsed.data.model,
    },
  };
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
