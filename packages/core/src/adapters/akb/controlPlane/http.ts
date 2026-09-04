import { z } from "zod";
import type { Span } from "@opentelemetry/api";
import {
  ControlPlaneError,
  type ControlPlaneErrorCategory,
} from "../../../errors";
import {
  AkbResponseDeadlineError,
  readAkbJsonBody,
} from "../core/responseBody";
import { stripTrailingSlashes } from "../../url";
import { observe, type ObserveFields } from "../../../observability";
import { withSpan } from "../core/tracing";

export const DEFAULT_CONTROL_PLANE_REQUEST_POLICY: ControlPlaneRequestPolicy = {
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

const WireErrorEnvelopeSchema = z.looseObject({
  code: z.unknown().optional(),
  error: z.unknown().optional(),
  detail: z.unknown().optional(),
});

export function normalizeControlPlaneBaseUrl(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Control-plane baseUrl must be a non-empty string");
  }
  const base = stripTrailingSlashes(value.trim());
  return base.endsWith("/api/v1") ? base : `${base}/api/v1`;
}

export function validateControlPlaneRequestPolicy(
  requestPolicy: ControlPlaneRequestPolicy | undefined,
): ControlPlaneRequestPolicy {
  const policy = requestPolicy ?? DEFAULT_CONTROL_PLANE_REQUEST_POLICY;
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

export function validateControlPlaneTokenSource(
  source: ControlPlaneTokenSource,
): void {
  if (typeof source === "string") {
    if (source.trim().length === 0) {
      throw new TypeError("Control-plane token must be non-empty");
    }
    return;
  }
  if (typeof source !== "function") {
    throw new TypeError("Control-plane token must be a string or function");
  }
}

export function resolveControlPlaneToken(
  source: ControlPlaneTokenSource,
): string {
  const supplied = typeof source === "function" ? source() : source;
  if (typeof supplied !== "string" || supplied.trim().length === 0) {
    throw new Error("missing control-plane token");
  }
  return supplied;
}

export function controlPlaneError(
  operation: string,
  context: Omit<
    ConstructorParameters<typeof ControlPlaneError>[0],
    "operation"
  >,
): ControlPlaneError {
  return new ControlPlaneError({ ...context, operation });
}

export function classifyControlPlaneStatus(status: number): {
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

function nestedErrorCode(value: unknown): unknown {
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

export async function readSafeControlPlaneErrorCode(
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
      ? safeUpstreamCode(nestedErrorCode(parsed.data), token)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function requestControlPlaneJson({
  baseUrl,
  tokenSource,
  requestFetch,
  policy,
  operation,
  path,
  init,
  acceptedStatuses,
}: {
  baseUrl: string;
  tokenSource: ControlPlaneTokenSource;
  requestFetch: typeof fetch;
  policy: ControlPlaneRequestPolicy;
  operation: string;
  path: string;
  init: RequestInit;
  acceptedStatuses: readonly number[];
}): Promise<{ status: number; body: unknown }> {
  let token: string;
  try {
    token = resolveControlPlaneToken(tokenSource);
  } catch {
    throw controlPlaneError(operation, {
      category: "authentication",
      upstreamStatus: 0,
      httpStatus: 401,
      retryable: false,
      upstreamCode: "missing_admin_token",
    });
  }

  const signal = AbortSignal.timeout(policy.timeoutMs);
  let response: Response;
  try {
    response = await requestFetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
      redirect: "manual",
      signal,
    });
  } catch {
    throw controlPlaneError(operation, {
      category: signal.aborted ? "unavailable" : "transport",
      upstreamStatus: 0,
      httpStatus: 503,
      retryable: true,
      upstreamCode: signal.aborted ? "response_timeout" : "transport_error",
    });
  }

  if (response.status < 200 || response.status >= 300) {
    const upstreamCode = await readSafeControlPlaneErrorCode(
      response,
      policy,
      signal,
      token,
    );
    throw controlPlaneError(operation, {
      ...classifyControlPlaneStatus(response.status),
      upstreamCode,
    });
  }
  if (!acceptedStatuses.includes(response.status)) {
    throw controlPlaneError(operation, {
      category: "invalid_response",
      upstreamStatus: response.status,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }
  try {
    return {
      status: response.status,
      body: await readAkbJsonBody(response, {
        maxBytes: policy.maxJsonResponseBytes,
        signal,
      }),
    };
  } catch (error) {
    const timedOut = error instanceof AkbResponseDeadlineError;
    throw controlPlaneError(operation, {
      category: timedOut ? "unavailable" : "invalid_response",
      upstreamStatus: response.status,
      httpStatus: timedOut ? 503 : 502,
      retryable: true,
      upstreamCode: timedOut ? "response_timeout" : "invalid_response",
    });
  }
}

export function withControlPlaneSpan<T>(
  operation: string,
  work: (span: Span, setUpstreamStatus: (status: number) => void) => Promise<T>,
): Promise<T> {
  return withSpan(
    `akb.control_plane.${operation}`,
    {
      "control_plane.operation": operation,
      "control_plane.actor_mode": "system_admin",
    },
    async (span) => {
      const startedAt = Date.now();
      let upstreamStatus = 200;
      let fields: ObserveFields = {};
      let level: "info" | "warn" = "info";
      try {
        const result = await work(span, (status) => {
          upstreamStatus = status;
        });
        fields = { "control_plane.upstream_status": upstreamStatus };
        return result;
      } catch (error) {
        fields =
          error instanceof ControlPlaneError ? errorObserveFields(error) : {};
        level = "warn";
        throw error;
      } finally {
        observe(
          span,
          {
            "control_plane.operation": operation,
            "control_plane.actor_mode": "system_admin",
            ...fields,
            "control_plane.duration_ms": Date.now() - startedAt,
          },
          "akb control-plane operation",
          { level },
        );
      }
    },
  );
}

export function errorObserveFields(
  error: ControlPlaneError,
): Record<string, string | number | boolean | undefined> {
  return {
    "control_plane.upstream_status": error.upstreamStatus,
    "control_plane.upstream_code": error.upstreamCode,
    "control_plane.retryable": error.retryable,
  };
}
