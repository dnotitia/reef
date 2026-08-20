import {
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import {
  AKB_AUTH_V2_ACCOUNT_DENIAL_CODES,
  type AkbAuthV2AccountDenialCode,
} from "@reef/core";

/**
 * The clock skew accepted by the auth-v2 contract.  A deployment may tighten
 * this value, but it must not widen it beyond the bounded maximum below.
 */
export const DEFAULT_OIDC_CLOCK_TOLERANCE_SECONDS = 5;
export const MAX_OIDC_CLOCK_TOLERANCE_SECONDS = 60;

const MAX_TOKEN_BYTES = 512 * 1024;
const MAX_CLAIM_BYTES = 2_048;
const MAX_KID_BYTES = 255;
const PROVIDER_ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/u;
const REALM_PATH_PATTERN = /^\/realms\/[A-Za-z0-9._~-]+$/u;

/**
 * Values from the validated auth-v2 provider entry. `canonicalIssuer`,
 * `audience`, and `clientId` are deliberately supplied by the selected Reef
 * runtime, never read from a token or a token-directed key source. The AKB
 * catalog may advertise several values for other deployments, but this
 * validator receives exactly one runtime audience/client pair.
 */
export interface OidcTokenValidatorConfig {
  canonicalIssuer: string;
  audience: string;
  clientId: string;
  providerAlias: string;
  /** A fixed JWKS resolver owned by Reef configuration. */
  jwks: JWTVerifyGetKey;
  clockToleranceSeconds?: number;
  now?: () => Date;
}

export type OidcTokenValidationCode =
  | "oidc_validator_config_invalid"
  | "oidc_token_invalid"
  | "oidc_keyset_unavailable";

export type OidcTokenValidationKind = "invalid" | "unavailable";

/**
 * Bounded error surfaced by this module.  It intentionally does not retain a
 * token, claims, a key response, or an upstream error as a property.
 */
export class OidcTokenValidationError extends Error {
  constructor(
    readonly code: OidcTokenValidationCode,
    readonly kind: OidcTokenValidationKind,
  ) {
    super(code);
    this.name = "OidcTokenValidationError";
  }
}

/** Claims that a caller may use after cryptographic and contract validation. */
export interface ValidatedOidcToken {
  issuer: string;
  audience: string | readonly string[];
  subject: string;
  authorizedParty: string;
  providerAlias: string;
  tokenType: "Bearer";
  expiresAt: number;
  issuedAt?: number;
  notBefore?: number;
  sessionId?: string;
}

export interface OidcTokenValidator {
  validate(accessToken: string): Promise<ValidatedOidcToken>;
}

/** Stable AKB account-denial values owned by the core contract. */
export type AccountDenialCode = AkbAuthV2AccountDenialCode;

export type AccountValidationResult<Account> =
  | { outcome: "accepted"; account: Account }
  | { outcome: "denied"; code: AccountDenialCode }
  | { outcome: "unavailable" };

export type AccountValidationErrorCode =
  | "account_validation_required"
  | "account_validation_invalid"
  | "account_validation_unavailable"
  | AccountDenialCode;

export type AccountValidationErrorKind =
  | "required"
  | "invalid"
  | "unavailable"
  | "denied";

/**
 * Explicit boundary error for the AKB account-validation call.  OIDC claims
 * are not an account record; callers must handle this error/result instead of
 * manufacturing an account from `sub`, `preferred_username`, or email.
 */
export class AccountValidationError extends Error {
  constructor(
    readonly code: AccountValidationErrorCode,
    readonly kind: AccountValidationErrorKind,
  ) {
    super(code);
    this.name = "AccountValidationError";
  }
}

export interface AccountValidationInput {
  /** The already verified bearer token, for the AKB adapter's Authorization header. */
  accessToken: string;
  subject: string;
  issuer: string;
  providerAlias: string;
}

export type AccountValidator<Account> = (
  input: AccountValidationInput,
) => Promise<AccountValidationResult<Account>>;

export interface OidcAuthenticatedPrincipal<Account> {
  identity: ValidatedOidcToken;
  account: Account;
}

/**
 * Construct a validator with a fixed issuer and runtime audience/client pair,
 * provider alias.  The key resolver is injected so the caller can pin it to a
 * configured JWKS URL; this module never follows `jku`, `jwk`, `x5u`, or `x5c`
 * values from a token header.
 */
export function createOidcTokenValidator(
  config: OidcTokenValidatorConfig,
): OidcTokenValidator {
  const validated = validateConfig(config);
  const now = config.now ?? (() => new Date());
  const clockToleranceSeconds =
    config.clockToleranceSeconds ?? DEFAULT_OIDC_CLOCK_TOLERANCE_SECONDS;

  return {
    async validate(accessToken: string): Promise<ValidatedOidcToken> {
      assertTokenInput(accessToken);
      assertPinnedHeader(accessToken);

      let payload: JWTPayload;
      const currentDate = now();
      try {
        ({ payload } = await jwtVerify(accessToken, config.jwks, {
          algorithms: ["RS256"],
          issuer: validated.canonicalIssuer,
          audience: validated.audience,
          clockTolerance: clockToleranceSeconds,
          currentDate,
        }));
      } catch (error) {
        throw mapVerificationError(error);
      }

      return parseValidatedClaims(
        payload,
        validated,
        currentDate,
        clockToleranceSeconds,
      );
    },
  };
}

/** Convenience form for one-shot validation. */
export function validateOidcToken(
  accessToken: string,
  config: OidcTokenValidatorConfig,
): Promise<ValidatedOidcToken> {
  return createOidcTokenValidator(config).validate(accessToken);
}

/**
 * Verify an OIDC bearer token and then require a positive AKB account result.
 * This function has no fallback account projection: an absent, malformed, or
 * non-accepted AKB response is an explicit boundary error.
 */
export async function validateOidcTokenAndAccount<Account>(
  accessToken: string,
  validator: OidcTokenValidator,
  accountValidator: AccountValidator<Account>,
): Promise<OidcAuthenticatedPrincipal<Account>> {
  const identity = await validator.validate(accessToken);
  if (typeof accountValidator !== "function") {
    throw new AccountValidationError("account_validation_required", "required");
  }

  let result: AccountValidationResult<Account>;
  try {
    result = await accountValidator({
      accessToken,
      subject: identity.subject,
      issuer: identity.issuer,
      providerAlias: identity.providerAlias,
    });
  } catch (error) {
    if (error instanceof AccountValidationError) throw error;
    throw new AccountValidationError(
      "account_validation_unavailable",
      "unavailable",
    );
  }

  if (!isAccountValidationResult(result)) {
    throw new AccountValidationError("account_validation_invalid", "invalid");
  }
  if (result.outcome === "accepted") {
    return { identity, account: result.account };
  }
  if (result.outcome === "denied") {
    throw new AccountValidationError(result.code, "denied");
  }
  throw new AccountValidationError(
    "account_validation_unavailable",
    "unavailable",
  );
}

function validateConfig(
  config: OidcTokenValidatorConfig,
): OidcTokenValidatorConfig {
  if (!config || typeof config !== "object") {
    throw new OidcTokenValidationError(
      "oidc_validator_config_invalid",
      "invalid",
    );
  }

  const canonicalIssuer = validateCanonicalIssuer(config.canonicalIssuer);
  const audience = validateIdentifier(config.audience);
  const clientId = validateIdentifier(config.clientId);
  const providerAlias = config.providerAlias;
  if (
    typeof providerAlias !== "string" ||
    !PROVIDER_ALIAS_PATTERN.test(providerAlias)
  ) {
    throw new OidcTokenValidationError(
      "oidc_validator_config_invalid",
      "invalid",
    );
  }
  if (typeof config.jwks !== "function") {
    throw new OidcTokenValidationError(
      "oidc_validator_config_invalid",
      "invalid",
    );
  }

  const clockToleranceSeconds =
    config.clockToleranceSeconds ?? DEFAULT_OIDC_CLOCK_TOLERANCE_SECONDS;
  if (
    !Number.isInteger(clockToleranceSeconds) ||
    clockToleranceSeconds < 0 ||
    clockToleranceSeconds > MAX_OIDC_CLOCK_TOLERANCE_SECONDS
  ) {
    throw new OidcTokenValidationError(
      "oidc_validator_config_invalid",
      "invalid",
    );
  }
  if (config.now !== undefined && typeof config.now !== "function") {
    throw new OidcTokenValidationError(
      "oidc_validator_config_invalid",
      "invalid",
    );
  }

  return {
    ...config,
    canonicalIssuer,
    audience,
    clientId,
    providerAlias,
    clockToleranceSeconds,
  };
}

function validateCanonicalIssuer(value: string): string {
  if (typeof value !== "string" || value.length > 512) {
    throw new OidcTokenValidationError(
      "oidc_validator_config_invalid",
      "invalid",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OidcTokenValidationError(
      "oidc_validator_config_invalid",
      "invalid",
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname.endsWith("/") ||
    !REALM_PATH_PATTERN.test(parsed.pathname)
  ) {
    throw new OidcTokenValidationError(
      "oidc_validator_config_invalid",
      "invalid",
    );
  }
  return parsed.toString();
}

function validateIdentifier(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CLAIM_BYTES ||
    containsControlCharacter(value)
  ) {
    throw new OidcTokenValidationError(
      "oidc_validator_config_invalid",
      "invalid",
    );
  }
  return value;
}

function assertTokenInput(accessToken: string): void {
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.length > MAX_TOKEN_BYTES
  ) {
    throw new OidcTokenValidationError("oidc_token_invalid", "invalid");
  }
}

function assertPinnedHeader(accessToken: string): void {
  let header: Record<string, unknown>;
  try {
    header = decodeProtectedHeader(accessToken) as Record<string, unknown>;
  } catch {
    throw new OidcTokenValidationError("oidc_token_invalid", "invalid");
  }

  if (
    header.alg !== "RS256" ||
    header.typ !== "JWT" ||
    typeof header.kid !== "string" ||
    header.kid.length === 0 ||
    header.kid.length > MAX_KID_BYTES ||
    containsControlCharacter(header.kid) ||
    ["jku", "jwk", "x5u", "x5c"].some((name) =>
      Object.prototype.hasOwnProperty.call(header, name),
    )
  ) {
    throw new OidcTokenValidationError("oidc_token_invalid", "invalid");
  }
}

function parseValidatedClaims(
  payload: JWTPayload,
  config: OidcTokenValidatorConfig,
  currentDate: Date,
  clockToleranceSeconds: number,
): ValidatedOidcToken {
  const issuer = payload.iss;
  const subject = payload.sub;
  const authorizedParty = payload.azp;
  const providerAlias = payload.identity_provider;
  const tokenType = payload.typ;
  const expiresAt = payload.exp;
  const audience = payload.aud;

  if (
    issuer !== config.canonicalIssuer ||
    !isAudience(audience, config.audience) ||
    typeof subject !== "string" ||
    !isBoundedClaim(subject) ||
    typeof authorizedParty !== "string" ||
    authorizedParty !== config.clientId ||
    typeof providerAlias !== "string" ||
    providerAlias !== config.providerAlias ||
    tokenType !== "Bearer" ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= 0
  ) {
    throw new OidcTokenValidationError("oidc_token_invalid", "invalid");
  }

  const issuedAt = optionalNumericClaim(payload.iat);
  const notBefore = optionalNumericClaim(payload.nbf);
  const sessionId = optionalStringClaim(payload.sid);

  if (
    issuedAt !== undefined &&
    issuedAt > Math.floor(currentDate.getTime() / 1_000) + clockToleranceSeconds
  ) {
    throw new OidcTokenValidationError("oidc_token_invalid", "invalid");
  }

  return {
    issuer,
    audience: normalizeAudience(audience),
    subject,
    authorizedParty,
    providerAlias,
    tokenType: "Bearer",
    expiresAt,
    ...(issuedAt === undefined ? {} : { issuedAt }),
    ...(notBefore === undefined ? {} : { notBefore }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

function isAudience(
  value: JWTPayload["aud"],
  accepted: string,
): value is string | string[] {
  if (typeof value === "string") return value === accepted;
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string") &&
    value.some((entry) => entry === accepted)
  );
}

function normalizeAudience(
  value: JWTPayload["aud"],
): string | readonly string[] {
  if (typeof value === "string") return value;
  return [...(value ?? [])];
}

function optionalNumericClaim(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new OidcTokenValidationError("oidc_token_invalid", "invalid");
  }
  return value as number;
}

function optionalStringClaim(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isBoundedClaim(value)) {
    throw new OidcTokenValidationError("oidc_token_invalid", "invalid");
  }
  return value;
}

function isBoundedClaim(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CLAIM_BYTES &&
    !containsControlCharacter(value)
  );
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function mapVerificationError(error: unknown): OidcTokenValidationError {
  if (
    error instanceof joseErrors.JWKSTimeout ||
    error instanceof joseErrors.JWKSInvalid ||
    (error instanceof joseErrors.JOSEError && error.code === "ERR_JOSE_GENERIC")
  ) {
    return new OidcTokenValidationError(
      "oidc_keyset_unavailable",
      "unavailable",
    );
  }
  return new OidcTokenValidationError("oidc_token_invalid", "invalid");
}

function isAccountValidationResult<Account>(
  value: unknown,
): value is AccountValidationResult<Account> {
  if (!value || typeof value !== "object") return false;
  const outcome = (value as { outcome?: unknown }).outcome;
  if (outcome === "accepted") {
    return (
      Object.prototype.hasOwnProperty.call(value, "account") &&
      (value as { account?: unknown }).account !== undefined &&
      (value as { account?: unknown }).account !== null
    );
  }
  if (outcome === "denied") {
    const code = (value as { code?: unknown }).code;
    return (
      typeof code === "string" &&
      (AKB_AUTH_V2_ACCOUNT_DENIAL_CODES as readonly string[]).includes(code)
    );
  }
  return outcome === "unavailable";
}
