import { z } from "zod";

export type ReefAuthMode = "local" | "sso";

type AuthEnvironment = Readonly<Record<string, string | undefined>>;

export interface LocalAuthRuntimeConfig {
  mode: "local";
}

export interface SsoAuthRuntimeConfig {
  mode: "sso";
  issuer: string;
  clientId: string;
  akbApiAudience: string;
  publicOrigin: string;
  redisUrl: string | null;
  encryptionKey: Uint8Array | null;
}

export type AuthRuntimeConfig = LocalAuthRuntimeConfig | SsoAuthRuntimeConfig;

export class AuthConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AuthConfigurationError";
  }
}

const BOUNDED_IDENTIFIER = z.string().trim().min(1).max(255);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function readAuthRuntimeConfig(
  env: AuthEnvironment = process.env,
): AuthRuntimeConfig {
  const mode = env.REEF_AUTH_MODE;
  if (mode !== "local" && mode !== "sso") {
    throw new AuthConfigurationError("auth_mode_invalid");
  }
  if (mode === "local") return { mode };

  const issuer = readHttpsUrl(env.REEF_KEYCLOAK_ISSUER, {
    code: "sso_issuer_invalid",
    bareOrigin: false,
    allowLoopbackHttp: env.NODE_ENV !== "production",
  });
  const clientId = readIdentifier(
    env.REEF_KEYCLOAK_CLIENT_ID,
    "sso_client_id_invalid",
  );
  const akbApiAudience = readIdentifier(
    env.REEF_AKB_API_AUDIENCE,
    "sso_akb_audience_invalid",
  );
  const publicOrigin = readHttpsUrl(env.REEF_PUBLIC_ORIGIN, {
    code: "sso_public_origin_invalid",
    bareOrigin: true,
    allowLoopbackHttp: env.NODE_ENV !== "production",
  });

  const redisUrl = readRedisUrl(env.REEF_SESSION_REDIS_URL);
  const encryptionKey = readEncryptionKey(env.REEF_SESSION_ENCRYPTION_KEY);
  const ephemeralAllowed =
    env.NODE_ENV === "development" || env.NODE_ENV === "test";
  if (!ephemeralAllowed) {
    if (!redisUrl) {
      throw new AuthConfigurationError("sso_session_redis_required");
    }
    if (!encryptionKey) {
      throw new AuthConfigurationError("sso_session_encryption_key_required");
    }
  }

  return {
    mode,
    issuer,
    clientId,
    akbApiAudience,
    publicOrigin,
    redisUrl,
    encryptionKey,
  };
}

export function readAuthMode(env: AuthEnvironment = process.env): ReefAuthMode {
  return readAuthRuntimeConfig(env).mode;
}

function readIdentifier(value: string | undefined, code: string): string {
  const result = BOUNDED_IDENTIFIER.safeParse(value);
  if (!result.success || containsControlCharacter(result.data)) {
    throw new AuthConfigurationError(code);
  }
  return result.data;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function readHttpsUrl(
  value: string | undefined,
  options: {
    code: string;
    bareOrigin: boolean;
    allowLoopbackHttp: boolean;
  },
): string {
  let parsed: URL;
  try {
    parsed = new URL(value ?? "");
  } catch {
    throw new AuthConfigurationError(options.code);
  }
  const loopbackHttp =
    options.allowLoopbackHttp &&
    parsed.protocol === "http:" &&
    LOOPBACK_HOSTS.has(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !loopbackHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (options.bareOrigin && parsed.pathname !== "/")
  ) {
    throw new AuthConfigurationError(options.code);
  }
  return options.bareOrigin
    ? parsed.origin
    : parsed.toString().replace(/\/$/u, "");
}

function readRedisUrl(value: string | undefined): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AuthConfigurationError("sso_session_redis_url_invalid");
  }
  if (
    !["redis:", "rediss:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.hash
  ) {
    throw new AuthConfigurationError("sso_session_redis_url_invalid");
  }
  return parsed.toString();
}

function readEncryptionKey(value: string | undefined): Uint8Array | null {
  if (!value) return null;
  let decoded: Buffer;
  if (/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    decoded = Buffer.from(value, "base64url");
  } else if (/^[A-Za-z0-9+/]{43}=$/u.test(value)) {
    decoded = Buffer.from(value, "base64");
  } else {
    throw new AuthConfigurationError("sso_session_encryption_key_invalid");
  }
  if (decoded.byteLength !== 32) {
    throw new AuthConfigurationError("sso_session_encryption_key_invalid");
  }
  return new Uint8Array(decoded);
}
