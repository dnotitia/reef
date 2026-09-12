import { isIP } from "node:net";

export type AuthV2Environment = Readonly<Record<string, string | undefined>>;

export interface AuthV2DisabledRuntimeConfig {
  readonly enabled: false;
  readonly mode: "local";
}

export interface AuthV2EnabledRuntimeConfig {
  readonly enabled: true;
  readonly mode: "sso";
  readonly issuer: string;
  readonly transportUrl: string;
  readonly clientId: string;
  readonly audience: string;
  readonly publicOrigin: string;
  readonly redisUrl: string;
  readonly encryptionKey: Uint8Array;
  readonly sessionNamespace: string;
}

export type AuthV2RuntimeConfig =
  | AuthV2DisabledRuntimeConfig
  | AuthV2EnabledRuntimeConfig;

export type AuthV2ConfigurationErrorCode =
  | "auth_mode_required"
  | "auth_mode_invalid"
  | "auth_v2_issuer_invalid"
  | "auth_v2_transport_required"
  | "auth_v2_transport_invalid"
  | "auth_v2_client_id_invalid"
  | "auth_v2_audience_invalid"
  | "auth_v2_public_origin_invalid"
  | "auth_v2_redis_required"
  | "auth_v2_redis_invalid"
  | "auth_v2_encryption_key_required"
  | "auth_v2_encryption_key_invalid"
  | "auth_v2_session_namespace_required"
  | "auth_v2_session_namespace_invalid";

export class AuthV2ConfigurationError extends Error {
  constructor(readonly code: AuthV2ConfigurationErrorCode) {
    super(code);
    this.name = "AuthV2ConfigurationError";
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const REALM_PATH = /^\/realms\/[A-Za-z0-9._~-]+$/u;
const IDENTIFIER_MAX_LENGTH = 255;
const NAMESPACE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function readAuthV2RuntimeConfig(
  env: AuthV2Environment = process.env,
): AuthV2RuntimeConfig {
  const mode = readMode(env);
  if (mode === "local") return { enabled: false, mode };

  const production = env.NODE_ENV !== "development" && env.NODE_ENV !== "test";
  const allowLoopbackHttp = !production;
  const issuer = readRealmUrl(env.REEF_KEYCLOAK_ISSUER, allowLoopbackHttp);
  const transportUrl = readTransportUrl(
    env.REEF_KEYCLOAK_TRANSPORT_URL,
    issuer,
    production,
  );
  const clientId = readIdentifier(
    env.REEF_KEYCLOAK_CLIENT_ID,
    "auth_v2_client_id_invalid",
  );
  const audience = readIdentifier(
    env.REEF_AKB_API_AUDIENCE,
    "auth_v2_audience_invalid",
  );
  const publicOrigin = readPublicOrigin(
    env.REEF_PUBLIC_ORIGIN,
    allowLoopbackHttp,
  );
  const redisUrl = readRedisUrl(env.REEF_SESSION_REDIS_URL, production);
  const encryptionKey = readEncryptionKey(
    env.REEF_SESSION_ENCRYPTION_KEY,
    production,
  );
  const sessionNamespace = readSessionNamespace(
    env.REEF_AUTH_SESSION_NAMESPACE,
    production,
  );

  return {
    enabled: true,
    mode,
    issuer,
    transportUrl,
    clientId,
    audience,
    publicOrigin,
    redisUrl,
    encryptionKey,
    sessionNamespace,
  };
}

export function requireAuthV2RuntimeConfig(
  env: AuthV2Environment = process.env,
): AuthV2EnabledRuntimeConfig {
  const config = readAuthV2RuntimeConfig(env);
  if (!config.enabled) {
    throw new AuthV2ConfigurationError("auth_mode_invalid");
  }
  return config;
}

export function summarizeAuthV2RuntimeConfig(config: AuthV2RuntimeConfig): {
  enabled: boolean;
  mode: "local" | "sso";
  redisConfigured: boolean;
  encryptionKeyConfigured: boolean;
} {
  return {
    enabled: config.enabled,
    mode: config.mode,
    redisConfigured: config.enabled && Boolean(config.redisUrl),
    encryptionKeyConfigured:
      config.enabled && config.encryptionKey.byteLength === 32,
  };
}

function readMode(env: AuthV2Environment): "local" | "sso" {
  const raw = env.REEF_AUTH_MODE?.trim().toLowerCase();
  if (!raw) {
    if (env.NODE_ENV === "test" || env.NODE_ENV === "development")
      return "local";
    throw new AuthV2ConfigurationError("auth_mode_required");
  }
  if (raw !== "local" && raw !== "sso") {
    throw new AuthV2ConfigurationError("auth_mode_invalid");
  }
  return raw;
}

function readIdentifier(
  value: string | undefined,
  code: "auth_v2_client_id_invalid" | "auth_v2_audience_invalid",
): string {
  const normalized = value?.trim();
  if (
    !normalized ||
    normalized.length > IDENTIFIER_MAX_LENGTH ||
    hasControlCharacter(normalized)
  ) {
    throw new AuthV2ConfigurationError(code);
  }
  return normalized;
}

function readRealmUrl(
  value: string | undefined,
  allowLoopbackHttp: boolean,
): string {
  const parsed = parseUrl(value, "auth_v2_issuer_invalid");
  const loopbackHttp =
    allowLoopbackHttp &&
    parsed.protocol === "http:" &&
    LOOPBACK_HOSTS.has(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !loopbackHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    isIP(parsed.hostname.replace(/^\[|\]$/gu, "")) !== 0 ||
    !REALM_PATH.test(normalizeRealmPath(parsed.pathname))
  ) {
    throw new AuthV2ConfigurationError("auth_v2_issuer_invalid");
  }
  return formatRealmUrl(parsed, "auth_v2_issuer_invalid");
}

function readTransportUrl(
  value: string | undefined,
  issuer: string,
  required: boolean,
): string {
  if (!value?.trim()) {
    if (required) {
      throw new AuthV2ConfigurationError("auth_v2_transport_required");
    }
    return issuer;
  }
  const parsed = parseUrl(value, "auth_v2_transport_invalid");
  const canonical = new URL(issuer);
  const normalizedPath = normalizeRealmPath(parsed.pathname);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    isIP(parsed.hostname.replace(/^\[|\]$/gu, "")) !== 0 ||
    !normalizedPath ||
    normalizedPath !== canonical.pathname ||
    parsed.hostname.toLowerCase() === canonical.hostname.toLowerCase() ||
    !isClusterHostname(parsed.hostname)
  ) {
    throw new AuthV2ConfigurationError("auth_v2_transport_invalid");
  }
  return formatRealmUrl(parsed, "auth_v2_transport_invalid");
}

function readPublicOrigin(
  value: string | undefined,
  allowLoopbackHttp: boolean,
): string {
  const parsed = parseUrl(value, "auth_v2_public_origin_invalid");
  const loopbackHttp =
    allowLoopbackHttp &&
    parsed.protocol === "http:" &&
    LOOPBACK_HOSTS.has(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !loopbackHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new AuthV2ConfigurationError("auth_v2_public_origin_invalid");
  }
  return parsed.origin;
}

function readRedisUrl(value: string | undefined, production: boolean): string {
  const raw = value?.trim();
  if (!raw) {
    if (production)
      throw new AuthV2ConfigurationError("auth_v2_redis_required");
    return "redis://localhost:6379";
  }
  const parsed = parseUrl(raw, "auth_v2_redis_invalid");
  if (
    !["redis:", "rediss:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.hash
  ) {
    throw new AuthV2ConfigurationError("auth_v2_redis_invalid");
  }
  return parsed.toString();
}

function readEncryptionKey(
  value: string | undefined,
  production: boolean,
): Uint8Array {
  const raw = value?.trim();
  if (!raw) {
    if (production) {
      throw new AuthV2ConfigurationError("auth_v2_encryption_key_required");
    }
    return new Uint8Array(32);
  }
  let decoded: Buffer;
  try {
    decoded = /^[A-Za-z0-9_-]{43}$/u.test(raw)
      ? Buffer.from(raw, "base64url")
      : /^[A-Za-z0-9+/]{43}=$/u.test(raw)
        ? Buffer.from(raw, "base64")
        : Buffer.alloc(0);
  } catch {
    decoded = Buffer.alloc(0);
  }
  if (decoded.byteLength !== 32) {
    throw new AuthV2ConfigurationError("auth_v2_encryption_key_invalid");
  }
  return new Uint8Array(decoded);
}

function readSessionNamespace(
  value: string | undefined,
  production: boolean,
): string {
  const raw = value?.trim();
  if (!raw) {
    if (production) {
      throw new AuthV2ConfigurationError("auth_v2_session_namespace_required");
    }
    return "test";
  }
  if (!NAMESPACE_RE.test(raw) || hasControlCharacter(raw)) {
    throw new AuthV2ConfigurationError("auth_v2_session_namespace_invalid");
  }
  return raw;
}

function parseUrl<T extends AuthV2ConfigurationErrorCode>(
  value: string | undefined,
  code: T,
): URL {
  try {
    return new URL(value?.trim() ?? "");
  } catch {
    throw new AuthV2ConfigurationError(code);
  }
}

function normalizeRealmPath(pathname: string): string {
  const normalized = pathname.replace(/\/$/u, "");
  return normalized;
}

function formatRealmUrl(
  url: URL,
  code: "auth_v2_issuer_invalid" | "auth_v2_transport_invalid",
): string {
  const path = normalizeRealmPath(url.pathname);
  if (!REALM_PATH.test(path)) throw new AuthV2ConfigurationError(code);
  return `${url.origin}${path}`;
}

function isClusterHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized.endsWith(".")) return false;
  const labels = normalized.split(".");
  if (labels.length === 1)
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(labels[0] ?? "");
  if (
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label),
    )
  ) {
    return false;
  }
  const svc = labels.indexOf("svc");
  return svc >= 2 && labels.length > svc + 1;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
