import {
  type LlmAdapter,
  createLlmAdapter,
} from "@/server/adapters/llmAdapter";
import { type LLMConfig, LLMConfigSchema } from "@reef/core";

export type ServerLlmState = "disabled" | "enabled" | "invalid";

export interface ServerLlmStatus {
  isConfigured: boolean;
  state: ServerLlmState;
  model: string | null;
}

export type ServerLlmConfigResolution =
  | {
      ok: true;
      config: LLMConfig | null;
      status: ServerLlmStatus;
    }
  | {
      ok: false;
      status: ServerLlmStatus;
      issues: string[];
    };

export class ServerLlmConfigError extends Error {
  constructor(readonly issues: string[]) {
    super("server_llm_config_invalid");
    this.name = "ServerLlmConfigError";
  }
}

type ServerEnvironment = Readonly<Record<string, string | undefined>>;

const trimToNull = (value: string | undefined): string | null =>
  value?.trim() || null;

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

function invalidResolution(
  issues: string[],
  model: string | null,
): ServerLlmConfigResolution {
  return {
    ok: false,
    status: {
      isConfigured: false,
      state: "invalid",
      model,
    },
    issues,
  };
}

/**
 * Resolves one provider-neutral OpenAI-compatible LLM endpoint. Authentication,
 * platform membership, and LLM availability are independent capabilities; no
 * LLM variables is a valid disabled state rather than a readiness failure.
 */
export function resolveServerLlmConfig(
  env: ServerEnvironment = process.env,
): ServerLlmConfigResolution {
  const apiKey = trimToNull(env.REEF_LLM_API_KEY);
  const baseUrl = trimToNull(env.REEF_LLM_BASE_URL);
  const model = trimToNull(env.REEF_LLM_MODEL);
  const values = [apiKey, baseUrl, model];
  const configuredCount = values.filter(Boolean).length;

  if (configuredCount === 0) {
    return {
      ok: true,
      config: null,
      status: {
        isConfigured: false,
        state: "disabled",
        model: null,
      },
    };
  }

  if (configuredCount !== values.length) {
    return invalidResolution(
      [
        "REEF_LLM_API_KEY, REEF_LLM_BASE_URL, and REEF_LLM_MODEL must be set together",
      ],
      model,
    );
  }

  const parsed = LLMConfigSchema.safeParse({
    api_key: apiKey,
    base_url: normalizeBaseUrl(baseUrl ?? ""),
    model,
  });
  if (!parsed.success) {
    return invalidResolution(
      parsed.error.issues.map((issue) => issue.message),
      model,
    );
  }

  return {
    ok: true,
    config: parsed.data,
    status: {
      isConfigured: true,
      state: "enabled",
      model: parsed.data.model,
    },
  };
}

export function createServerLlmAdapter(config: LLMConfig): LlmAdapter {
  return createLlmAdapter({
    apiKey: config.api_key,
    baseUrl: config.base_url,
    model: config.model,
  });
}

export function getRequiredServerLlmConfig(
  env: ServerEnvironment = process.env,
): LLMConfig {
  const resolved = resolveServerLlmConfig(env);
  if (!resolved.ok) {
    throw new ServerLlmConfigError(resolved.issues);
  }
  if (!resolved.config) {
    throw new ServerLlmConfigError(["LLM is not configured"]);
  }
  return resolved.config;
}
