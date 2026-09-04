import { z } from "zod";
import { type ControlPlaneError, SchemaValidationError } from "../../../errors";
import {
  ControlPlaneIdSchema,
  ControlPlaneRolloutResultSchema,
  ControlPlaneRolloutSchema,
  ReleaseSha256Schema,
  type ControlPlaneRollout,
  type ControlPlaneRolloutResult,
} from "../../../schemas/controlPlane";
import {
  controlPlaneError,
  normalizeControlPlaneBaseUrl,
  requestControlPlaneJson,
  withControlPlaneSpan,
  type ControlPlaneRequestPolicy,
  type ControlPlaneTokenSource,
  validateControlPlaneRequestPolicy,
  validateControlPlaneTokenSource,
} from "./http";

const REQUEST_OPERATION = "apps.rollouts.request";
const GET_OPERATION = "apps.rollouts.get";
const RESUME_OPERATION = "apps.rollouts.resume";

const RolloutStatusSchema = z.enum([
  "pending",
  "running",
  "applied",
  "blocked",
]);

const WireRolloutStepSchema = z.looseObject({
  step_id: z.string().min(1),
  operation: z.string().min(1),
  state: z.string().min(1),
  checkpoint: z.unknown().optional(),
  reason: z.string().nullable().optional(),
  reason_code: z.string().nullable().optional(),
});

const WireRolloutTargetSchema = z.looseObject({
  target_id: ControlPlaneIdSchema,
  installation_id: ControlPlaneIdSchema,
  vault_id: ControlPlaneIdSchema,
  ordinal: z.number().int().nonnegative(),
  batch: z.number().int().nonnegative(),
  canary: z.boolean(),
  state: z.string().min(1),
  reason: z.string().nullable().optional(),
  reason_code: z.string().nullable().optional(),
  steps: z.array(WireRolloutStepSchema).optional(),
});

const WireRolloutSchema = z.looseObject({
  job_id: ControlPlaneIdSchema,
  app_id: ControlPlaneIdSchema,
  release_id: ControlPlaneIdSchema,
  manifest_checksum: ReleaseSha256Schema,
  status: RolloutStatusSchema,
  blocked_reason: z.string().nullable().optional(),
  created_at: z.string().min(1).optional(),
  updated_at: z.string().min(1).optional(),
  completed_at: z.string().nullable().optional(),
  targets: z.array(WireRolloutTargetSchema).optional(),
  replayed: z.boolean().optional(),
  source_rollout_id: ControlPlaneIdSchema.nullable().optional(),
  resume_outcome: z.enum(["accepted", "replayed", "denied"]).optional(),
  resume_reason: z.string().nullable().optional(),
});

export interface AkbAppRolloutConfig {
  baseUrl: string;
  adminToken: ControlPlaneTokenSource;
  fetch?: typeof fetch;
  requestPolicy?: ControlPlaneRequestPolicy;
}

export interface RolloutRequestInput {
  appId: string;
  releaseId: string;
  manifestChecksum: string;
  idempotencyKey: string;
}

export interface RolloutResumeInput extends RolloutRequestInput {
  sourceRolloutId: string;
}

export interface AkbAppRollout {
  readonly requestRollout: (
    input: RolloutRequestInput,
  ) => Promise<ControlPlaneRolloutResult>;
  readonly getRollout: (
    appId: string,
    jobId: string,
  ) => Promise<ControlPlaneRollout>;
  readonly resumeRollout: (
    input: RolloutResumeInput,
  ) => Promise<ControlPlaneRolloutResult>;
}

function parseId(value: string, field: string): string {
  const parsed = ControlPlaneIdSchema.safeParse(value);
  if (parsed.success) return parsed.data.toLowerCase();
  throw new SchemaValidationError({
    field,
    clientValidated: true,
    issues: [`${field} must be a UUID`],
  });
}

function parseChecksum(value: string): string {
  const parsed = ReleaseSha256Schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new SchemaValidationError({
    field: "manifestChecksum",
    clientValidated: true,
    issues: ["manifestChecksum must be a SHA-256 checksum"],
  });
}

function rolloutError(
  operation: string,
  context: Omit<
    ConstructorParameters<typeof ControlPlaneError>[0],
    "operation"
  >,
): ControlPlaneError {
  return controlPlaneError(operation, context);
}

function safeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return /^[a-z][a-z0-9_.:-]{0,63}$/u.test(reason) ? reason : null;
}

function mapRollout(
  value: unknown,
  operation: string,
  upstreamStatus = 200,
): ControlPlaneRollout {
  const wire = WireRolloutSchema.safeParse(value);
  if (!wire.success) {
    throw rolloutError(operation, {
      category: "invalid_response",
      upstreamStatus,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }
  try {
    return ControlPlaneRolloutSchema.parse({
      jobId: wire.data.job_id,
      appId: wire.data.app_id,
      releaseId: wire.data.release_id,
      manifestChecksum: wire.data.manifest_checksum,
      status: wire.data.status,
      blockedReason: safeReason(wire.data.blocked_reason),
      createdAt: wire.data.created_at,
      updatedAt: wire.data.updated_at,
      completedAt: wire.data.completed_at,
      targets: (wire.data.targets ?? []).map((target) => ({
        targetId: target.target_id,
        installationId: target.installation_id,
        vaultId: target.vault_id,
        ordinal: target.ordinal,
        batch: target.batch,
        canary: target.canary,
        state: target.state,
        reason: safeReason(target.reason ?? target.reason_code),
        // Checkpoints are AKB worker state, not part of Reef's public receipt.
        steps: (target.steps ?? []).map((step) => ({
          stepId: step.step_id,
          operation: step.operation,
          state: step.state,
          checkpoint: {},
          reason: safeReason(step.reason ?? step.reason_code),
        })),
      })),
      replayed: wire.data.replayed,
      sourceRolloutId: wire.data.source_rollout_id,
      resumeOutcome: wire.data.resume_outcome,
      resumeReason: safeReason(wire.data.resume_reason),
    });
  } catch {
    throw rolloutError(operation, {
      category: "invalid_response",
      upstreamStatus,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }
}

function parseInput(input: RolloutRequestInput): {
  appId: string;
  releaseId: string;
  manifestChecksum: string;
  idempotencyKey: string;
} {
  return {
    appId: parseId(input.appId, "appId"),
    releaseId: parseId(input.releaseId, "releaseId"),
    manifestChecksum: parseChecksum(input.manifestChecksum),
    idempotencyKey: parseId(input.idempotencyKey, "idempotencyKey"),
  };
}

function assertAcceptedResponse(
  result: ControlPlaneRollout,
  status: number,
  operation: string,
): ControlPlaneRolloutResult {
  if (status !== 200 && status !== 202) {
    throw rolloutError(operation, {
      category: "invalid_response",
      upstreamStatus: status,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }
  if (
    (status === 200 && result.replayed !== true) ||
    (status === 202 && result.replayed === true)
  ) {
    throw rolloutError(operation, {
      category: "invalid_response",
      upstreamStatus: status,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }
  return ControlPlaneRolloutResultSchema.parse({
    rollout: result,
    responseStatus: status,
  });
}

export function createAkbAppRollout(
  config: AkbAppRolloutConfig,
): AkbAppRollout {
  const baseUrl = normalizeControlPlaneBaseUrl(config.baseUrl);
  validateControlPlaneTokenSource(config.adminToken);
  const policy = validateControlPlaneRequestPolicy(config.requestPolicy);
  const requestFetch = config.fetch ?? fetch;

  return Object.freeze({
    requestRollout: (input: RolloutRequestInput) => {
      const parsed = parseInput(input);
      return withControlPlaneSpan(
        REQUEST_OPERATION,
        async (span, setUpstreamStatus) => {
          const response = await requestControlPlaneJson({
            baseUrl,
            tokenSource: config.adminToken,
            requestFetch,
            policy,
            operation: REQUEST_OPERATION,
            path: `/apps/${encodeURIComponent(parsed.appId)}/rollouts`,
            init: {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": parsed.idempotencyKey,
              },
              body: JSON.stringify({
                release_id: parsed.releaseId,
                manifest_checksum: parsed.manifestChecksum,
              }),
            },
            acceptedStatuses: [200, 202],
          });
          setUpstreamStatus(response.status);
          span.setAttribute("control_plane.http_status", response.status);
          const rollout = mapRollout(
            response.body,
            REQUEST_OPERATION,
            response.status,
          );
          if (
            rollout.appId !== parsed.appId ||
            rollout.releaseId !== parsed.releaseId ||
            rollout.manifestChecksum !== parsed.manifestChecksum
          ) {
            throw rolloutError(REQUEST_OPERATION, {
              category: "invalid_response",
              upstreamStatus: response.status,
              httpStatus: 502,
              retryable: true,
              upstreamCode: "invalid_response",
            });
          }
          return assertAcceptedResponse(
            rollout,
            response.status,
            REQUEST_OPERATION,
          );
        },
      );
    },

    getRollout: (appId: string, jobId: string) => {
      const parsedAppId = parseId(appId, "appId");
      const parsedJobId = parseId(jobId, "jobId");
      return withControlPlaneSpan(GET_OPERATION, async (span) => {
        const response = await requestControlPlaneJson({
          baseUrl,
          tokenSource: config.adminToken,
          requestFetch,
          policy,
          operation: GET_OPERATION,
          path: `/apps/${encodeURIComponent(parsedAppId)}/rollouts/${encodeURIComponent(parsedJobId)}`,
          init: { method: "GET" },
          acceptedStatuses: [200],
        });
        span.setAttribute("control_plane.http_status", response.status);
        const rollout = mapRollout(
          response.body,
          GET_OPERATION,
          response.status,
        );
        if (rollout.appId !== parsedAppId || rollout.jobId !== parsedJobId) {
          throw rolloutError(GET_OPERATION, {
            category: "invalid_response",
            upstreamStatus: response.status,
            httpStatus: 502,
            retryable: true,
            upstreamCode: "invalid_response",
          });
        }
        return rollout;
      });
    },

    resumeRollout: (input: RolloutResumeInput) => {
      const parsed = parseInput(input);
      const sourceRolloutId = parseId(input.sourceRolloutId, "sourceRolloutId");
      return withControlPlaneSpan(
        RESUME_OPERATION,
        async (span, setUpstreamStatus) => {
          const response = await requestControlPlaneJson({
            baseUrl,
            tokenSource: config.adminToken,
            requestFetch,
            policy,
            operation: RESUME_OPERATION,
            path: `/apps/${encodeURIComponent(parsed.appId)}/rollouts/${encodeURIComponent(sourceRolloutId)}/resume`,
            init: {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": parsed.idempotencyKey,
              },
              body: JSON.stringify({
                release_id: parsed.releaseId,
                manifest_checksum: parsed.manifestChecksum,
              }),
            },
            acceptedStatuses: [200, 202],
          });
          setUpstreamStatus(response.status);
          span.setAttribute("control_plane.http_status", response.status);
          const rollout = mapRollout(
            response.body,
            RESUME_OPERATION,
            response.status,
          );
          if (
            rollout.appId !== parsed.appId ||
            rollout.releaseId !== parsed.releaseId ||
            rollout.manifestChecksum !== parsed.manifestChecksum ||
            rollout.sourceRolloutId !== sourceRolloutId
          ) {
            throw rolloutError(RESUME_OPERATION, {
              category: "invalid_response",
              upstreamStatus: response.status,
              httpStatus: 502,
              retryable: true,
              upstreamCode: "invalid_response",
            });
          }
          return assertAcceptedResponse(
            rollout,
            response.status,
            RESUME_OPERATION,
          );
        },
      );
    },
  });
}
