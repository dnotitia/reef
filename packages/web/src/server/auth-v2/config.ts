import { isIP } from "node:net";

/**
 * The auth-v2 configuration is intentionally server-only.  It describes the
 * deployment-managed half of the Reef/AKB contract; the AKB provider catalog
 * and account-validation policy are loaded separately from AKB.
 */

export type AuthV2Environment = Readonly<Record<string, string | undefined>>;

export interface AuthV2DisabledRuntimeConfig {
  readonly enabled: false;
}

export interface AuthV2EnabledRuntimeConfig {
  readonly enabled: true;

  /** The public, canonical Keycloak realm issuer used in token claims. */
  readonly issuer: string;
  /** The private/in-cluster realm URL used for server-to-Keycloak traffic. */
  readonly transportUrl: string;
  /** Reef's dedicated public Keycloak client id. */
  readonly clientId: string;
  /** The AKB resource-server audience accepted from access tokens. */
  readonly audience: string;
  /** Reef's deployment-managed origin for OIDC callbacks and logout. */
  readonly publicOrigin: string;

  /**
   * Redis is nullable only for development and test. Production auth-v2 must
   * use a deployment-managed Redis endpoint.
   */
  readonly redisUrl: string | null;
  /**
   * A dedicated 32-byte AES key. It is kept as bytes so the base64 secret is
   * never needed by downstream crypto code or accidentally sent over a wire.
   * It is nullable only for development and test.
   */
  readonly encryptionKey: Uint8Array | null;
}

export type AuthV2RuntimeConfig =
  | AuthV2DisabledRuntimeConfig
  | AuthV2EnabledRuntimeConfig;

export type AuthV2ConfigurationErrorCode =
  | "auth_v2_opt_in_invalid"
  | "auth_v2_issuer_invalid"
  | "auth_v2_transport_required"
  | "auth_v2_transport_invalid"
  | "auth_v2_client_id_invalid"
  | "auth_v2_audience_invalid"
  | "auth_v2_public_origin_invalid"
  | "auth_v2_redis_required"
  | "auth_v2_redis_invalid"
  | "auth_v2_encryption_key_required"
  | "auth_v2_encryption_key_invalid";

/**
 * Deliberately contains only a stable code.  In particular, this error must
 * not include a Redis URL, encryption key, or an upstream response body.
 */
export class AuthV2ConfigurationError extends Error {
  constructor(readonly code: AuthV2ConfigurationErrorCode) {
    super(code);
    this.name = "AuthV2ConfigurationError";
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const REALM_PATH = /^\/realms\/[A-Za-z0-9._~-]+$/u;
const IDENTIFIER_MAX_LENGTH = 255;

/**
 * Read the deployment-managed auth-v2 profile.
 *
 * The profile is disabled unless `REEF_AUTH_V2_ENABLED` is explicitly set to
 * `1` or `true`.  Once opted in, malformed or partial configuration throws;
 * there is no fallback to the legacy AKB auth flow from this module.
 */
export function readAuthV2RuntimeConfig(
  env: AuthV2Environment = process.env,
): AuthV2RuntimeConfig {
  const enabled = readOptInFlag(env.REEF_AUTH_V2_ENABLED);
  if (!enabled) return { enabled: false };

  const production = env.NODE_ENV !== "development" && env.NODE_ENV !== "test";
  const allowLoopbackHttp = !production;
  const issuer = readRealmUrl(env.REEF_KEYCLOAK_ISSUER, {
    code: "auth_v2_issuer_invalid",
    allowLoopbackHttp,
  });
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
  const redisUrl = readRedisUrl(env.REEF_SESSION_REDIS_URL);
  const encryptionKey = readEncryptionKey(env.REEF_SESSION_ENCRYPTION_KEY);

  if (production && !redisUrl) {
    throw new AuthV2ConfigurationError("auth_v2_redis_required");
  }
  if (production && !encryptionKey) {
    throw new AuthV2ConfigurationError("auth_v2_encryption_key_required");
  }

  return {
    enabled: true,
    issuer,
    transportUrl,
    clientId,
    audience,
    publicOrigin,
    redisUrl,
    encryptionKey,
  };
}

/**
 * Resolve auth-v2 when a caller is explicitly taking that dependency.  This
 * keeps the disabled state distinguishable from a configured profile and
 * gives callers a stable, non-secret failure code.
 */
export function requireAuthV2RuntimeConfig(
  env: AuthV2Environment = process.env,
): AuthV2EnabledRuntimeConfig {
  const config = readAuthV2RuntimeConfig(env);
  if (!config.enabled) {
    throw new AuthV2ConfigurationError("auth_v2_opt_in_invalid");
  }
  return config;
}

/**
 * Return safe readiness metadata for diagnostics.  Secret-bearing values are
 * intentionally absent so callers can log this object without redaction bugs.
 */
export function summarizeAuthV2RuntimeConfig(config: AuthV2RuntimeConfig): {
  enabled: boolean;
  redisConfigured: boolean;
  encryptionKeyConfigured: boolean;
} {
  return {
    enabled: config.enabled,
    redisConfigured: config.enabled && config.redisUrl !== null,
    encryptionKeyConfigured: config.enabled && config.encryptionKey !== null,
  };
}

function readOptInFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "" || normalized === "0" || normalized === "false") {
    return false;
  }
  if (normalized === "1" || normalized === "true") return true;
  throw new AuthV2ConfigurationError("auth_v2_opt_in_invalid");
}

function readIdentifier(
  value: string | undefined,
  code: "auth_v2_client_id_invalid" | "auth_v2_audience_invalid",
): string {
  const normalized = value?.trim();
  if (
    !normalized ||
    normalized.length > IDENTIFIER_MAX_LENGTH ||
    containsControlCharacter(normalized)
  ) {
    throw new AuthV2ConfigurationError(code);
  }
  return normalized;
}

function readRealmUrl(
  value: string | undefined,
  options: {
    code: "auth_v2_issuer_invalid";
    allowLoopbackHttp: boolean;
  },
): string {
  const parsed = parseUrl(value, options.code);
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
    isIpHostname(parsed.hostname) ||
    !normalizeRealmPath(parsed.pathname)
  ) {
    throw new AuthV2ConfigurationError(options.code);
  }

  return formatRealmUrl(parsed, options.code);
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
    // A public issuer is acceptable only as an explicit development/test
    // convenience. Production always takes the branch above.
    return issuer;
  }

  const parsed = parseUrl(value, "auth_v2_transport_invalid");
  const canonicalIssuer = new URL(issuer);
  const normalizedPath = normalizeRealmPath(parsed.pathname);
  const sameIssuerHost =
    parsed.hostname.toLowerCase() === canonicalIssuer.hostname.toLowerCase();
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    isIpHostname(parsed.hostname) ||
    isLoopbackHost(parsed.hostname) ||
    !normalizedPath ||
    normalizedPath !== canonicalIssuer.pathname ||
    sameIssuerHost ||
    !isInClusterHostname(parsed.hostname)
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
    isLoopbackHost(parsed.hostname);
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

function readRedisUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const parsed = parseUrl(value, "auth_v2_redis_invalid");
  if (
    !["redis:", "rediss:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.hash
  ) {
    throw new AuthV2ConfigurationError("auth_v2_redis_invalid");
  }
  return parsed.toString();
}

function readEncryptionKey(value: string | undefined): Uint8Array | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  let decoded: Buffer;
  if (/^[A-Za-z0-9_-]{43}$/u.test(normalized)) {
    decoded = Buffer.from(normalized, "base64url");
  } else if (/^[A-Za-z0-9+/]{43}=$/u.test(normalized)) {
    decoded = Buffer.from(normalized, "base64");
  } else {
    throw new AuthV2ConfigurationError("auth_v2_encryption_key_invalid");
  }
  if (decoded.byteLength !== 32) {
    throw new AuthV2ConfigurationError("auth_v2_encryption_key_invalid");
  }
  return new Uint8Array(decoded);
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

function normalizeRealmPath(pathname: string): string | null {
  const normalized = pathname.replace(/\/$/u, "");
  return REALM_PATH.test(normalized) ? normalized : null;
}

function formatRealmUrl(
  url: URL,
  code: "auth_v2_issuer_invalid" | "auth_v2_transport_invalid",
): string {
  const path = normalizeRealmPath(url.pathname);
  if (!path) throw new AuthV2ConfigurationError(code);
  return `${url.origin}${path}`;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isIpHostname(hostname: string): boolean {
  const unwrapped =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  return isIP(unwrapped) !== 0;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    LOOPBACK_HOSTS.has(hostname.toLowerCase()) ||
    hostname.toLowerCase().endsWith(".localhost")
  );
}

/**
 * Accept a Kubernetes service DNS name (including a short service name) and
 * reject public DNS names.  A deployment can still use HTTPS for the internal
 * hop; the hostname, not the scheme, establishes the topology boundary.
 */
function isInClusterHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized.endsWith(".")) return false;
  const labels = normalized.split(".");
  if (
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label),
    )
  ) {
    return false;
  }
  if (labels.length === 1) return true;
  const serviceLabel = labels.indexOf("svc");
  // Kubernetes service FQDNs are `<service>.<namespace>.svc.<cluster-domain>`;
  // require the service and namespace labels before `svc` so a public host
  // such as `identity.svc.example.com` cannot masquerade as cluster DNS.
  return serviceLabel >= 2 && labels.length > serviceLabel + 1;
}
