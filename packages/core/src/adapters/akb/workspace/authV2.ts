import { z } from "zod";
import { AkbApiError, AuthError, isAkbAccountErrorCode } from "../../../errors";
import { stripTrailingSlashes } from "../../url";
import { readAkbErrorResponse } from "../core/errorResponse";
import { readAkbJsonBody } from "../core/responseBody";
import { withSpan } from "../core/shared";
import { AkbUserSchema, type AkbUser } from "./auth";

/**
 * The only endpoint from which Reef may read the auth-v2 contract.
 *
 * Auth-v2 is deliberately a new wire contract.  The v1 `/auth/config`
 * response is not projected into this shape: callers must receive this exact
 * version marker and all of the fields below from AKB before they can opt in.
 */
export const AKB_AUTH_V2_CONFIG_PATH = "/api/v2/auth/config";

const AKB_AUTH_V2_TIMEOUT_MS = 5_000;
const MAX_AKB_AUTH_V2_TOKEN_BYTES = 512 * 1024;
const MAX_AKB_AUTH_V2_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_AUTH_V2_CATALOG_ENTRIES = 32;
const MAX_AUTH_V2_IDENTIFIER_LENGTH = 255;
const PROVIDER_ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/u;
const REALM_PATH_RE = /^\/realms\/[A-Za-z0-9._~-]+$/u;

/** Stable account-denial codes owned by AKB's account authority. */
export const AKB_AUTH_V2_ACCOUNT_DENIAL_CODES = [
  "membership_required",
  "account_suspended",
  "identity_conflict",
] as const;

export const AkbAuthV2AccountDenialCodeSchema = z.enum(
  AKB_AUTH_V2_ACCOUNT_DENIAL_CODES,
);

export type AkbAuthV2AccountDenialCode = z.infer<
  typeof AkbAuthV2AccountDenialCodeSchema
>;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isBoundedOpaqueValue(value: string, maxLength: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maxLength &&
    !hasControlCharacter(value) &&
    value === value.trim()
  );
}

/**
 * Identifiers are intentionally bounded and whitespace-normalized at the
 * contract boundary.  They are used as JWT audience/client values and must not
 * carry control characters into a verifier or a log field.
 */
export const AkbAuthV2IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_AUTH_V2_IDENTIFIER_LENGTH)
  .refine((value) => !hasControlCharacter(value), {
    message: "identifier must not contain control characters",
  });

/**
 * The canonical issuer is an external OIDC issuer, never a token endpoint or a
 * browser redirect.  It is therefore an HTTPS URL without credentials,
 * query, or fragment components.  AKB may use a different transport URL
 * internally; that private routing detail is intentionally absent here.
 */
export const AkbAuthV2CanonicalIssuerSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        REALM_PATH_RE.test(url.pathname)
      );
    } catch {
      return false;
    }
  }, "canonical_issuer must be an HTTPS URL without credentials, query, or fragment");

/**
 * Provider login links are AKB-owned paths.  Requiring an auth-v2 path keeps a
 * config response from becoming an open redirect when the value is later used
 * by the login surface.  The loader never follows this link server-side.
 */
export const AkbAuthV2ProviderLoginUrlSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value, "https://reef.invalid");
    } catch {
      return false;
    }
    return (
      url.origin === "https://reef.invalid" &&
      url.pathname.startsWith("/api/v2/auth/") &&
      url.search === "" &&
      url.hash === "" &&
      !url.pathname.includes("\\")
    );
  }, "login_url must be a path-only AKB auth-v2 endpoint");

export type AkbAuthV2ProviderType = "keycloak-oidc";

export const AkbAuthV2ProviderAliasSchema = z.string().regex(PROVIDER_ALIAS_RE);

/** Public provider catalog entry.  Secrets and token endpoints never cross it. */
export const AkbAuthV2ProviderSchema = z
  .object({
    alias: AkbAuthV2ProviderAliasSchema,
    display_name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((value) => !hasControlCharacter(value), {
        message: "display_name must not contain control characters",
      }),
    provider_type: z.literal("keycloak-oidc"),
    login_url: AkbAuthV2ProviderLoginUrlSchema,
  })
  .strict();

export type AkbAuthV2Provider = z.infer<typeof AkbAuthV2ProviderSchema>;

export const AkbAuthV2ProviderCatalogSchema = z
  .array(AkbAuthV2ProviderSchema)
  .max(MAX_AUTH_V2_CATALOG_ENTRIES)
  .superRefine((providers, context) => {
    const aliases = new Set<string>();
    providers.forEach((provider, index) => {
      if (aliases.has(provider.alias)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "alias"],
          message: "provider aliases must be unique",
        });
      }
      aliases.add(provider.alias);
    });
  });

export type AkbAuthV2ProviderCatalog = z.infer<
  typeof AkbAuthV2ProviderCatalogSchema
>;

function rejectDuplicateIdentifiers(
  values: readonly string[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: "catalog identifiers must be unique",
      });
    }
    seen.add(value);
  });
}

/**
 * AKB fixes the verifier policy in the v2 contract.  Reef does not infer
 * algorithms, token types, or provider-claim names from a JWT header.
 */
export const AkbAuthV2TokenValidationPolicySchema = z
  .object({
    algorithms: z.tuple([z.literal("RS256")]),
    access_token_type: z.literal("Bearer"),
    provider_claim: z.literal("identity_provider"),
  })
  .strict();

export type AkbAuthV2TokenValidationPolicy = z.infer<
  typeof AkbAuthV2TokenValidationPolicySchema
>;

/**
 * Account validation is an AKB boundary, not a Reef-side directory lookup.
 * The bearer credential is the Keycloak access token that the v2 AKB resource
 * server explicitly accepts. Subject binding is mandatory so a valid token
 * cannot be replayed for another account. The legacy `/api/v1/auth/me` route
 * is intentionally not used here.
 */
export const AkbAuthV2AccountValidationSchema = z
  .object({
    endpoint: z.literal("/api/v2/auth/account-validation"),
    credential: z.literal("bearer_access_token"),
    requires_subject_binding: z.literal(true),
    denial_codes: z
      .array(AkbAuthV2AccountDenialCodeSchema)
      .min(AKB_AUTH_V2_ACCOUNT_DENIAL_CODES.length)
      .max(MAX_AUTH_V2_CATALOG_ENTRIES)
      .refine(
        (codes) =>
          new Set(codes).size === codes.length &&
          AKB_AUTH_V2_ACCOUNT_DENIAL_CODES.every((code) =>
            codes.includes(code),
          ),
        "denial_codes must include every stable AKB account-denial code",
      ),
  })
  .strict();

export type AkbAuthV2AccountValidation = z.infer<
  typeof AkbAuthV2AccountValidationSchema
>;

const AkbAuthV2SubjectSchema = z
  .string()
  .min(1)
  .max(MAX_AUTH_V2_IDENTIFIER_LENGTH)
  .refine(
    (value) => isBoundedOpaqueValue(value, MAX_AUTH_V2_IDENTIFIER_LENGTH),
    {
      message: "subject must be a bounded opaque value",
    },
  );

export const AkbAuthV2AccountValidationRequestSchema = z
  .object({
    provider_alias: AkbAuthV2ProviderAliasSchema,
    subject: AkbAuthV2SubjectSchema,
  })
  .strict();

export type AkbAuthV2AccountValidationRequest = z.infer<
  typeof AkbAuthV2AccountValidationRequestSchema
>;

export const AkbAuthV2TokenPolicySchema = AkbAuthV2TokenValidationPolicySchema;
export type AkbAuthV2TokenPolicy = AkbAuthV2TokenValidationPolicy;

export const AkbAuthV2KeycloakSchema = z
  .object({
    enabled: z.boolean(),
    browser_session_ready: z.boolean(),
  })
  .strict();

export type AkbAuthV2Keycloak = z.infer<typeof AkbAuthV2KeycloakSchema>;

const AkbAuthV2LocalAuthSchema = z.object({ enabled: z.boolean() }).strict();

export const AkbAuthV2LocalAuthConfigSchema = AkbAuthV2LocalAuthSchema;
export type AkbAuthV2LocalAuthConfig = z.infer<
  typeof AkbAuthV2LocalAuthConfigSchema
>;

const authV2CommonShape = {
  schema_version: z.literal(2),
  local_auth: AkbAuthV2LocalAuthSchema,
  token_validation: AkbAuthV2TokenValidationPolicySchema,
  account_validation: AkbAuthV2AccountValidationSchema,
  keycloak: AkbAuthV2KeycloakSchema,
};

/** Local-only AKB deployments have no OIDC issuer or provider catalog. */
const AkbAuthV2LocalConfigSchema = z
  .object({
    ...authV2CommonShape,
    auth_mode: z.literal("local"),
    canonical_issuer: z.null(),
    accepted_audiences: z.array(AkbAuthV2IdentifierSchema).length(0),
    accepted_clients: z.array(AkbAuthV2IdentifierSchema).length(0),
    providers: z.array(AkbAuthV2ProviderSchema).length(0),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.keycloak.enabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keycloak", "enabled"],
        message: "local auth_mode cannot advertise enabled Keycloak SSO",
      });
    }
  });

/** SSO (including hybrid local+SSO) has a complete, non-empty OIDC contract. */
const AkbAuthV2SsoConfigSchema = z
  .object({
    ...authV2CommonShape,
    auth_mode: z.literal("sso"),
    canonical_issuer: AkbAuthV2CanonicalIssuerSchema,
    accepted_audiences: z
      .array(AkbAuthV2IdentifierSchema)
      .min(1)
      .max(MAX_AUTH_V2_CATALOG_ENTRIES)
      .superRefine(rejectDuplicateIdentifiers),
    accepted_clients: z
      .array(AkbAuthV2IdentifierSchema)
      .min(1)
      .max(MAX_AUTH_V2_CATALOG_ENTRIES)
      .superRefine(rejectDuplicateIdentifiers),
    providers: AkbAuthV2ProviderCatalogSchema.min(1),
  })
  .strict()
  .superRefine((config, context) => {
    if (!config.keycloak.enabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keycloak", "enabled"],
        message: "sso auth_mode requires Keycloak to be enabled",
      });
    }
  });

/**
 * Versioned AKB auth catalog.  This discriminated union intentionally rejects
 * the legacy `{ keycloak: { login_url, sso_only }, local_auth? }` response: it
 * has no `schema_version`, canonical issuer, verifier policy, or account
 * validation boundary and must not be projected into auth-v2.
 */
export const AkbAuthV2ConfigSchema = z.discriminatedUnion("auth_mode", [
  AkbAuthV2LocalConfigSchema,
  AkbAuthV2SsoConfigSchema,
]);

export type AkbAuthV2Config = z.infer<typeof AkbAuthV2ConfigSchema>;

/** Public account projection returned by the v2 validation endpoint. */
export const AkbAuthV2AccountValidationResponseSchema = z
  .object({ user: AkbUserSchema })
  .strict();

export type AkbAuthV2AccountValidationResponse = z.infer<
  typeof AkbAuthV2AccountValidationResponseSchema
>;

export interface ValidateAuthV2AccountParams {
  baseUrl: string;
  accessToken: string;
  providerAlias: string;
  subject: string;
}

export interface ValidateAuthV2AccountResult {
  user: AkbUser;
}

export interface GetAuthV2ConfigParams {
  baseUrl: string;
}

export interface GetAuthV2ConfigResult {
  config: AkbAuthV2Config;
}

/**
 * Read the unauthenticated AKB auth-v2 catalog with the same bounded-fetch
 * policy as the existing AKB auth adapter.  A malformed or legacy response is
 * an upstream contract error (`502`), never a fallback to auth-v1.
 */
export function getAuthV2Config(
  params: GetAuthV2ConfigParams,
): Promise<GetAuthV2ConfigResult> {
  const { baseUrl } = params;
  return withSpan("akb.auth_v2.config", {}, async (span) => {
    const payload = await fetchAuthV2Config(baseUrl);
    const parsed = AkbAuthV2ConfigSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AkbApiError({
        status: 502,
        message: "auth_v2_config_contract_mismatch",
      });
    }
    span.setAttribute("auth_mode", parsed.data.auth_mode);
    span.setAttribute("keycloak_enabled", parsed.data.keycloak.enabled);
    span.setAttribute("provider_count", parsed.data.providers.length);
    return { config: parsed.data };
  });
}

/**
 * Validate a locally verified OIDC principal at AKB's v2 boundary.
 *
 * This call deliberately accepts a Keycloak access token only because the
 * auth-v2 contract pins the issuer, audience, client, algorithm, and provider
 * claim before this function is reached. It must never be substituted with
 * `akbGetMe` or a legacy AKB JWT exchange.
 */
export function validateAuthV2Account(
  params: ValidateAuthV2AccountParams,
): Promise<ValidateAuthV2AccountResult> {
  const { baseUrl, accessToken, providerAlias, subject } = params;
  return withSpan("akb.auth_v2.account_validation", {}, async (span) => {
    const request = AkbAuthV2AccountValidationRequestSchema.safeParse({
      provider_alias: providerAlias,
      subject,
    });
    if (
      !isBoundedOpaqueValue(accessToken, MAX_AKB_AUTH_V2_TOKEN_BYTES) ||
      !request.success
    ) {
      throw new AkbApiError({
        status: 400,
        message: "auth_v2_account_validation_input_invalid",
      });
    }

    const url = `${stripTrailingSlashes(baseUrl)}/api/v2/auth/account-validation`;
    const signal = AbortSignal.timeout(AKB_AUTH_V2_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(request.data),
        redirect: "manual",
        cache: "no-store",
        signal,
      });
    } catch {
      throw new AkbApiError({
        status: 0,
        message: "auth_v2_account_validation_unavailable",
      });
    }

    if (!response.ok) {
      const error = await readAkbErrorResponse(response, {
        maxBytes: MAX_AKB_AUTH_V2_RESPONSE_BYTES,
        signal,
      });
      if (
        response.status === 401 ||
        response.status === 403 ||
        isAkbAccountErrorCode(error.code)
      ) {
        throw new AuthError({
          origin: "akb",
          code: isAkbAccountErrorCode(error.code) ? error.code : undefined,
          status: response.status,
          message: "auth_v2_account_validation_denied",
        });
      }
      throw new AkbApiError({
        status: response.status,
        message: "auth_v2_account_validation_failed",
      });
    }

    let payload: unknown;
    try {
      payload = await readAkbJsonBody(response, {
        maxBytes: MAX_AKB_AUTH_V2_RESPONSE_BYTES,
        signal,
      });
    } catch {
      throw new AkbApiError({
        status: 502,
        message: "auth_v2_account_validation_non_json",
      });
    }
    const parsed = AkbAuthV2AccountValidationResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AkbApiError({
        status: 502,
        message: "auth_v2_account_validation_shape_mismatch",
      });
    }
    span.setAttribute("provider_alias", providerAlias);
    return parsed.data;
  });
}

async function fetchAuthV2Config(baseUrl: string): Promise<unknown> {
  const url = `${stripTrailingSlashes(baseUrl)}${AKB_AUTH_V2_CONFIG_PATH}`;
  const signal = AbortSignal.timeout(AKB_AUTH_V2_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal,
    });
  } catch {
    throw new AkbApiError({
      status: 0,
      message: "auth_v2_config_unavailable",
    });
  }

  if (!response.ok) {
    const error = await readAkbErrorResponse(response, {
      maxBytes: MAX_AKB_AUTH_V2_RESPONSE_BYTES,
      signal,
    });
    if (
      response.status === 401 ||
      response.status === 403 ||
      isAkbAccountErrorCode(error.code)
    ) {
      throw new AuthError({
        origin: "akb",
        code: isAkbAccountErrorCode(error.code) ? error.code : undefined,
        status: response.status,
        message: "auth_v2_config_denied",
      });
    }
    throw new AkbApiError({
      status: response.status,
      message: "auth_v2_config_failed",
    });
  }

  try {
    return await readAkbJsonBody(response, {
      maxBytes: MAX_AKB_AUTH_V2_RESPONSE_BYTES,
      signal,
    });
  } catch {
    throw new AkbApiError({
      status: 502,
      message: "auth_v2_config_non_json",
    });
  }
}
