import { z } from "zod";
import {
  ControlPlaneError,
  type ControlPlaneErrorCategory,
  SchemaValidationError,
} from "../../../errors";
import {
  ControlPlaneIdSchema,
  ControlPlaneInstallationSchema,
  type ControlPlaneInstallation,
} from "../../../schemas/controlPlane";
import { observe, type ObserveFields } from "../../../observability";
import { stripTrailingSlashes } from "../../url";
import {
  AkbResponseDeadlineError,
  readAkbJsonBody,
} from "../core/responseBody";
import { withSpan } from "../core/tracing";

const OPERATION = "app.installations.get";
const DEFAULT_REQUEST_POLICY: ControlPlaneRequestPolicy = {
  timeoutMs: 10_000,
  maxJsonResponseBytes: 2_000_000,
};

export interface ControlPlaneRequestPolicy {
  timeoutMs: number;
  maxJsonResponseBytes: number;
}

export type ControlPlaneTokenSource =
  | string
  | (() => string | null | undefined);

export interface AkbAppInstallationReaderConfig {
  baseUrl: string;
  appToken: ControlPlaneTokenSource;
  fetch?: typeof fetch;
  requestPolicy?: ControlPlaneRequestPolicy;
}

export interface AkbAppInstallationReader {
  readonly getInstallation: (
    vaultId: string,
  ) => Promise<ControlPlaneInstallation>;
}

/*
 * These are private wire schemas. They accept future AKB fields, while every
 * field that crosses the public boundary is named explicitly in the mapper
 * below. In particular, checkpoint/error/resource/replay fields stay private.
 */
const WireReleaseReferenceSchema = z.looseObject({
  id: ControlPlaneIdSchema.nullable().optional(),
  version: z.string().nullable().optional(),
});

const WireGrantSchema = z.looseObject({
  generation: z.number().int().nonnegative(),
  status: z.enum(["active", "revoked"]),
  capabilities: z.array(z.string()),
});

const WireObservedSchema = z.looseObject({
  generation: z.number().int().nonnegative(),
  observed_at: z.string().nullable().optional(),
  release: WireReleaseReferenceSchema.nullable().optional(),
  schema_fingerprint: z.string().nullable().optional(),
  grant_generation: z.number().int().nonnegative().nullable().optional(),
  // Validated as opaque private data; neither field is projected.
  checkpoint: z.unknown().optional(),
  recent_error: z.unknown().nullable().optional(),
});

const WireDriftDimensionSchema = z.looseObject({
  status: z.enum(["in_sync", "mismatch", "unknown"]),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
});

const WireDriftSchema = z.looseObject({
  release: WireDriftDimensionSchema,
  schema: WireDriftDimensionSchema,
  grant: WireDriftDimensionSchema,
  overall: z.enum(["in_sync", "drifted", "unknown"]),
  reasons: z.array(z.string()),
  unknown_dimensions: z.array(z.string()),
});

const WireInstallationSchema = z.looseObject({
  installation_id: ControlPlaneIdSchema,
  app_id: ControlPlaneIdSchema,
  vault_id: ControlPlaneIdSchema,
  lifecycle: z.enum([
    "installing",
    "active",
    "upgrading",
    "blocked",
    "uninstalled",
  ]),
  blocked_reason: z.string().nullable().optional(),
  desired_release: WireReleaseReferenceSchema.nullable().optional(),
  current_release: WireReleaseReferenceSchema.nullable().optional(),
  observed: WireObservedSchema.nullable().optional(),
  desired_grant_generation: z.number().int().nonnegative().optional(),
  latest_grant: WireGrantSchema.nullable().optional(),
  active_grant: WireGrantSchema.nullable().optional(),
  // Accepted and intentionally ignored opaque AKB fields.
  owned_resources: z.unknown().optional(),
  checkpoint: z.unknown().optional(),
  recent_error: z.unknown().nullable().optional(),
  drift: WireDriftSchema.nullable().optional(),
  drift_classification: WireDriftSchema.nullable().optional(),
  command_status: z.unknown().nullable().optional(),
  replayed: z.unknown().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

const WireErrorEnvelopeSchema = z.looseObject({
  code: z.unknown().optional(),
  error: z.unknown().optional(),
  detail: z.unknown().optional(),
});

type WireInstallation = z.infer<typeof WireInstallationSchema>;
type WireReleaseReference = z.infer<typeof WireReleaseReferenceSchema>;
type WireGrant = z.infer<typeof WireGrantSchema>;
type WireObserved = z.infer<typeof WireObservedSchema>;
type WireDrift = z.infer<typeof WireDriftSchema>;

function normalizeBaseUrl(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Control-plane baseUrl must be a non-empty string");
  }
  const base = stripTrailingSlashes(value.trim());
  return base.endsWith("/api/v1") ? base : `${base}/api/v1`;
}

function validateRequestPolicy(
  requestPolicy: ControlPlaneRequestPolicy | undefined,
): ControlPlaneRequestPolicy {
  const policy = requestPolicy ?? DEFAULT_REQUEST_POLICY;
  if (
    !Number.isSafeInteger(policy.timeoutMs) ||
    policy.timeoutMs <= 0 ||
    !Number.isSafeInteger(policy.maxJsonResponseBytes) ||
    policy.maxJsonResponseBytes <= 0
  ) {
    throw new TypeError(
      "Control-plane request policy must use positive integer bounds",
    );
  }
  return policy;
}

function validateTokenSource(source: ControlPlaneTokenSource): void {
  if (typeof source === "string") {
    if (source.trim().length === 0) {
      throw new TypeError("Control-plane appToken must be non-empty");
    }
    return;
  }
  if (typeof source !== "function") {
    throw new TypeError("Control-plane appToken must be a string or function");
  }
}

function parseVaultId(vaultId: string): string {
  const parsed = ControlPlaneIdSchema.safeParse(vaultId);
  if (parsed.success) return parsed.data;
  throw new SchemaValidationError({
    field: "vaultId",
    clientValidated: true,
    issues: ["vaultId must be a UUID"],
  });
}

function controlPlaneError(
  context: Omit<
    ConstructorParameters<typeof ControlPlaneError>[0],
    "operation"
  >,
): ControlPlaneError {
  return new ControlPlaneError({ ...context, operation: OPERATION });
}

function classifyStatus(status: number): {
  category: ControlPlaneErrorCategory;
  httpStatus: number;
  retryable: boolean;
  upstreamStatus: number;
} {
  const upstreamStatus = Number.isInteger(status) && status >= 0 ? status : 0;
  if (upstreamStatus === 401) {
    return {
      category: "authentication",
      httpStatus: 401,
      retryable: false,
      upstreamStatus,
    };
  }
  if (upstreamStatus === 403) {
    return {
      category: "authorization",
      httpStatus: 403,
      retryable: false,
      upstreamStatus,
    };
  }
  if (upstreamStatus === 404) {
    return {
      category: "not_found",
      httpStatus: 404,
      retryable: false,
      upstreamStatus,
    };
  }
  if (upstreamStatus === 409) {
    return {
      category: "conflict",
      httpStatus: 409,
      retryable: false,
      upstreamStatus,
    };
  }
  if (upstreamStatus === 400 || upstreamStatus === 422) {
    return {
      category: "invalid_argument",
      httpStatus: upstreamStatus,
      retryable: false,
      upstreamStatus,
    };
  }
  if (upstreamStatus === 429) {
    return {
      category: "rate_limited",
      httpStatus: 429,
      retryable: true,
      upstreamStatus,
    };
  }
  if (upstreamStatus >= 500) {
    return {
      category: "unavailable",
      httpStatus: 503,
      retryable: true,
      upstreamStatus,
    };
  }
  return {
    category: "unknown",
    httpStatus: 502,
    retryable: false,
    upstreamStatus,
  };
}

function safeUpstreamCode(value: unknown, token: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  if (!/^[a-z0-9_.:-]{1,80}$/iu.test(candidate)) return undefined;
  const lowerCandidate = candidate.toLowerCase();
  const lowerToken = token.trim().toLowerCase();
  if (
    lowerToken.length > 0 &&
    (lowerCandidate.includes(lowerToken) || lowerToken.includes(lowerCandidate))
  ) {
    return undefined;
  }
  if (
    /(bearer|secret|credential|password|api[-_]?key|private|marker)/iu.test(
      candidate,
    )
  ) {
    return undefined;
  }
  return candidate;
}

function nestedCode(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.code !== undefined) return record.code;
  if (record.error && typeof record.error === "object") {
    const nested = (record.error as Record<string, unknown>).code;
    if (nested !== undefined) return nested;
  }
  if (record.detail && typeof record.detail === "object") {
    const nested = (record.detail as Record<string, unknown>).code;
    if (nested !== undefined) return nested;
  }
  return undefined;
}

async function readSafeErrorCode(
  response: Response,
  policy: ControlPlaneRequestPolicy,
  signal: AbortSignal,
  token: string,
): Promise<string | undefined> {
  try {
    const body = await readAkbJsonBody(response, {
      maxBytes: policy.maxJsonResponseBytes,
      signal,
    });
    const parsed = WireErrorEnvelopeSchema.safeParse(body);
    return parsed.success
      ? safeUpstreamCode(nestedCode(parsed.data), token)
      : undefined;
  } catch {
    return undefined;
  }
}

function mapReleaseReference(
  value: WireReleaseReference | null | undefined,
): ControlPlaneInstallation["desiredRelease"] {
  if (value === null || value === undefined) return value;
  return {
    id: value.id,
    version: value.version,
  };
}

function mapGrant(
  value: WireGrant | null | undefined,
): ControlPlaneInstallation["latestGrant"] {
  if (value === null || value === undefined) return value;
  return {
    generation: value.generation,
    status: value.status,
    capabilities: value.capabilities,
  };
}

function mapObserved(
  value: WireObserved | null | undefined,
): ControlPlaneInstallation["observed"] {
  if (value === null || value === undefined) return value;
  return {
    generation: value.generation,
    observedAt: value.observed_at,
    release: mapReleaseReference(value.release),
    schemaFingerprint: value.schema_fingerprint,
    grantGeneration: value.grant_generation,
  };
}

function mapDrift(
  value: WireDrift | null | undefined,
): ControlPlaneInstallation["drift"] {
  if (value === null || value === undefined) return value;
  return {
    release: { status: value.release.status },
    schema: { status: value.schema.status },
    grant: { status: value.grant.status },
    overall: value.overall,
    reasons: value.reasons,
    unknownDimensions: value.unknown_dimensions,
  };
}

function mapInstallation(value: WireInstallation): ControlPlaneInstallation {
  return ControlPlaneInstallationSchema.parse({
    installationId: value.installation_id,
    appId: value.app_id,
    vaultId: value.vault_id,
    lifecycle: value.lifecycle,
    blockedReason: value.blocked_reason,
    desiredRelease: mapReleaseReference(value.desired_release),
    currentRelease: mapReleaseReference(value.current_release),
    observed: mapObserved(value.observed),
    desiredGrantGeneration: value.desired_grant_generation,
    latestGrant: mapGrant(value.latest_grant),
    activeGrant: mapGrant(value.active_grant),
    drift: mapDrift(value.drift),
    driftClassification: mapDrift(value.drift_classification),
  });
}

function errorFields(error: ControlPlaneError): ObserveFields {
  return {
    "control_plane.upstream_status": error.upstreamStatus,
    "control_plane.upstream_code": error.upstreamCode,
    "control_plane.retryable": error.retryable,
  };
}

async function requestInstallation(
  baseUrl: string,
  tokenSource: ControlPlaneTokenSource,
  requestFetch: typeof fetch,
  policy: ControlPlaneRequestPolicy,
  vaultId: string,
): Promise<ControlPlaneInstallation> {
  let token: string;
  try {
    const supplied =
      typeof tokenSource === "function" ? tokenSource() : tokenSource;
    if (typeof supplied !== "string" || supplied.trim().length === 0) {
      throw new Error("missing app token");
    }
    token = supplied;
  } catch (error) {
    if (error instanceof ControlPlaneError) throw error;
    throw controlPlaneError({
      category: "authentication",
      upstreamStatus: 0,
      httpStatus: 401,
      retryable: false,
      upstreamCode: "missing_app_token",
    });
  }

  const signal = AbortSignal.timeout(policy.timeoutMs);
  const url = `${baseUrl}/app/installations/${encodeURIComponent(vaultId)}`;
  let response: Response;
  try {
    response = await requestFetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      redirect: "manual",
      signal,
    });
  } catch {
    if (signal.aborted) {
      throw controlPlaneError({
        category: "unavailable",
        upstreamStatus: 0,
        httpStatus: 503,
        retryable: true,
        upstreamCode: "response_timeout",
      });
    }
    throw controlPlaneError({
      category: "transport",
      upstreamStatus: 0,
      httpStatus: 503,
      retryable: true,
      upstreamCode: "transport_error",
    });
  }

  if (response.status < 200 || response.status >= 300) {
    const upstreamCode = await readSafeErrorCode(
      response,
      policy,
      signal,
      token,
    );
    throw controlPlaneError({
      ...classifyStatus(response.status),
      upstreamCode,
    });
  }
  if (response.status !== 200) {
    throw controlPlaneError({
      category: "invalid_response",
      upstreamStatus: response.status,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }

  let body: unknown;
  try {
    body = await readAkbJsonBody(response, {
      maxBytes: policy.maxJsonResponseBytes,
      signal,
    });
  } catch (error) {
    if (error instanceof AkbResponseDeadlineError) {
      throw controlPlaneError({
        category: "unavailable",
        upstreamStatus: response.status,
        httpStatus: 503,
        retryable: true,
        upstreamCode: "response_timeout",
      });
    }
    throw controlPlaneError({
      category: "invalid_response",
      upstreamStatus: response.status,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }

  const wire = WireInstallationSchema.safeParse(body);
  if (!wire.success) {
    throw controlPlaneError({
      category: "invalid_response",
      upstreamStatus: response.status,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }
  try {
    return mapInstallation(wire.data);
  } catch {
    throw controlPlaneError({
      category: "invalid_response",
      upstreamStatus: response.status,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }
}

export function createAkbAppInstallationReader(
  config: AkbAppInstallationReaderConfig,
): AkbAppInstallationReader {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  validateTokenSource(config.appToken);
  const policy = validateRequestPolicy(config.requestPolicy);
  const requestFetch = config.fetch ?? fetch;

  return Object.freeze({
    async getInstallation(vaultId: string): Promise<ControlPlaneInstallation> {
      const parsedVaultId = parseVaultId(vaultId);
      return withSpan(
        `akb.control_plane.${OPERATION}`,
        {
          "control_plane.operation": OPERATION,
          "control_plane.actor_mode": "app",
        },
        async (span) => {
          const startedAt = Date.now();
          let fields: ObserveFields = {};
          let level: "info" | "warn" = "info";
          try {
            const result = await requestInstallation(
              baseUrl,
              config.appToken,
              requestFetch,
              policy,
              parsedVaultId,
            );
            fields = {
              "control_plane.upstream_status": 200,
              "control_plane.retryable": false,
              "control_plane.lifecycle": result.lifecycle,
            };
            return result;
          } catch (caught) {
            const error =
              caught instanceof ControlPlaneError
                ? caught
                : controlPlaneError({
                    category: "invalid_response",
                    upstreamStatus: 200,
                    httpStatus: 502,
                    retryable: true,
                    upstreamCode: "invalid_response",
                  });
            fields = errorFields(error);
            level = "warn";
            throw error;
          } finally {
            observe(
              span,
              {
                "control_plane.operation": OPERATION,
                "control_plane.actor_mode": "app",
                ...fields,
                "control_plane.duration_ms": Date.now() - startedAt,
              },
              "akb control-plane operation",
              { level },
            );
          }
        },
      );
    },
  });
}
