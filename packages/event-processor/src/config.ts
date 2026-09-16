import { isIP } from "node:net";
import { VaultNameSchema } from "@reef/core";

export const EVENT_PROCESSOR_CONFIG_DEFAULTS = Object.freeze({
  host: "0.0.0.0",
  port: 9_090,
  reconnectDelayMs: 1_000,
  reconciliationIntervalMs: 300_000,
  drainTimeoutMs: 20_000,
});

export interface EventProcessorConfig {
  baseUrl: string;
  credential: string;
  vault: string;
  host: string;
  port: number;
  reconnectDelayMs: number;
  reconciliationIntervalMs: number;
  drainTimeoutMs: number;
}

export class EventProcessorConfigurationError extends Error {
  readonly variable: string;

  constructor(variable: string, reason: string) {
    super(`${variable} ${reason}`);
    this.name = "EventProcessorConfigurationError";
    this.variable = variable;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function requiredString(environment: Environment, name: string): string {
  const value = environment[name];
  if (
    value === undefined ||
    value.length === 0 ||
    value.trim() !== value ||
    /[\r\n]/u.test(value)
  ) {
    throw new EventProcessorConfigurationError(
      name,
      "must be a non-empty value",
    );
  }
  return value;
}

function parseBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EventProcessorConfigurationError(
      "AKB_BACKEND_URL",
      "must be a valid absolute URL",
    );
  }

  const hostname = url.hostname.toLowerCase();
  const privateHttpHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".svc.cluster.local");
  const secureTransport =
    url.protocol === "https:" || (url.protocol === "http:" && privateHttpHost);
  if (
    !secureTransport ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new EventProcessorConfigurationError(
      "AKB_BACKEND_URL",
      "must be an HTTPS origin (or a private local HTTP origin) without credentials, path, query, or fragment",
    );
  }
  return url.origin;
}

function parseHost(environment: Environment): string {
  const value = environment.REEF_EVENT_PROCESSOR_HOST;
  if (value === undefined) return EVENT_PROCESSOR_CONFIG_DEFAULTS.host;
  if (
    value.length === 0 ||
    value.trim() !== value ||
    (isIP(value) === 0 &&
      value !== "localhost" &&
      !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/u.test(
        value,
      ))
  ) {
    throw new EventProcessorConfigurationError(
      "REEF_EVENT_PROCESSOR_HOST",
      "must be an IP address or hostname",
    );
  }
  return value;
}

function parseInteger(
  environment: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = environment[name];
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) {
    throw new EventProcessorConfigurationError(name, "must be an integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new EventProcessorConfigurationError(
      name,
      `must be between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

/** Parse and validate the deployment-managed private process configuration. */
export function parseEventProcessorConfig(
  environment: Environment,
): EventProcessorConfig {
  const baseUrl = parseBaseUrl(requiredString(environment, "AKB_BACKEND_URL"));
  const credential = requiredString(
    environment,
    "REEF_EVENT_PROCESSOR_AKB_TOKEN",
  );
  const vault = requiredString(environment, "REEF_EVENT_PROCESSOR_VAULT");
  if (!VaultNameSchema.safeParse(vault).success) {
    throw new EventProcessorConfigurationError(
      "REEF_EVENT_PROCESSOR_VAULT",
      "must be a valid AKB vault name",
    );
  }

  return {
    baseUrl,
    credential,
    vault,
    host: parseHost(environment),
    port: parseInteger(
      environment,
      "REEF_EVENT_PROCESSOR_PORT",
      EVENT_PROCESSOR_CONFIG_DEFAULTS.port,
      1,
      65_535,
    ),
    reconnectDelayMs: parseInteger(
      environment,
      "REEF_EVENT_PROCESSOR_RECONNECT_DELAY_MS",
      EVENT_PROCESSOR_CONFIG_DEFAULTS.reconnectDelayMs,
      100,
      60_000,
    ),
    reconciliationIntervalMs: parseInteger(
      environment,
      "REEF_EVENT_PROCESSOR_RECONCILIATION_INTERVAL_MS",
      EVENT_PROCESSOR_CONFIG_DEFAULTS.reconciliationIntervalMs,
      15_000,
      86_400_000,
    ),
    drainTimeoutMs: parseInteger(
      environment,
      "REEF_EVENT_PROCESSOR_DRAIN_TIMEOUT_MS",
      EVENT_PROCESSOR_CONFIG_DEFAULTS.drainTimeoutMs,
      1_000,
      60_000,
    ),
  };
}
