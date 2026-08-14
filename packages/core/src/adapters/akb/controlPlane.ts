import { z } from "zod";
import {
  ControlPlaneError,
  type ControlPlaneErrorCategory,
  SchemaValidationError,
} from "../../errors";
import {
  ControlPlaneAppCreateInputSchema,
  ControlPlaneAppSchema,
  ControlPlaneAppUpdateInputSchema,
  ControlPlaneAuthorizeInputSchema,
  ControlPlaneAuthorizeSchema,
  ControlPlaneCredentialExchangeInputSchema,
  ControlPlaneCredentialExchangeSchema,
  type ControlPlaneDriftSchema,
  ControlPlaneEligibilitySchema,
  type ControlPlaneGrantSchema,
  ControlPlaneIdSchema,
  ControlPlaneInstallationCommandInputSchema,
  ControlPlaneInstallationSchema,
  ControlPlaneInventorySchema,
  ControlPlaneListInventoryOptionsSchema,
  type ControlPlaneObservedSchema,
  ControlPlaneObservedStateInputSchema,
  ControlPlaneObservedStateResultSchema,
  ControlPlaneReleaseCreateInputSchema,
  type ControlPlaneReleaseReferenceSchema,
  ControlPlaneReleaseSchema,
  ControlPlaneRolloutInputSchema,
  ControlPlaneRolloutSchema,
  ControlPlaneSnapshotCreateSchema,
  ControlPlaneSnapshotSchema,
  ControlPlaneJsonObjectSchema,
  ControlPlaneJsonValueSchema,
  type ControlPlaneApp,
  type ControlPlaneAppCreateInput,
  type ControlPlaneAppUpdateInput,
  type ControlPlaneAuthorize,
  type ControlPlaneAuthorizeInput,
  type ControlPlaneCredentialExchange,
  type ControlPlaneEligibility,
  type ControlPlaneInstallation,
  type ControlPlaneInstallationCommandInput,
  type ControlPlaneInventory,
  type ControlPlaneListInventoryOptions,
  type ControlPlaneObservedStateInput,
  type ControlPlaneObservedStateResult,
  type ControlPlaneRelease,
  type ControlPlaneReleaseCreateInput,
  type ControlPlaneRollout,
  type ControlPlaneRolloutInput,
  type ControlPlaneSnapshot,
  type ControlPlaneSnapshotCreate,
} from "../../schemas/controlPlane";
import { observe, type ObserveFields } from "../../observability";
import { stripTrailingSlashes } from "../url";
import { readAkbJsonBody } from "./core/responseBody";
import { withSpan } from "./core/tracing";

type TokenSource = string | (() => string | null | undefined);

export interface ControlPlaneRequestPolicy {
  timeoutMs: number;
  maxJsonResponseBytes: number;
}

export interface ControlPlaneAdminAdapterConfig {
  baseUrl: string;
  adminToken: TokenSource;
  fetch?: typeof fetch;
  requestPolicy?: ControlPlaneRequestPolicy;
}

export interface ControlPlaneAppAdapterConfig {
  baseUrl: string;
  appToken: TokenSource;
  fetch?: typeof fetch;
  requestPolicy?: ControlPlaneRequestPolicy;
}

export interface ControlPlaneCredentialExchangeConfig {
  baseUrl: string;
  credential: string;
  fetch?: typeof fetch;
  requestPolicy?: ControlPlaneRequestPolicy;
}

export type ControlPlaneActorMode = "admin" | "app" | "exchange";

export type ControlPlaneOperation =
  | "admin.apps.create"
  | "admin.apps.get"
  | "admin.apps.update"
  | "admin.releases.create"
  | "admin.releases.get"
  | "admin.installations.apply"
  | "admin.installations.get"
  | "admin.installations.uninstall"
  | "admin.inventory.list"
  | "admin.inventory.reportObserved"
  | "admin.snapshots.create"
  | "admin.snapshots.get"
  | "admin.snapshots.evaluate"
  | "admin.rollouts.request"
  | "admin.rollouts.get"
  | "admin.rollouts.resume"
  | "app.authorize"
  | "app.installations.get"
  | "app.inventory.list"
  | "app.inventory.reportObserved"
  | "app.snapshots.create"
  | "app.snapshots.get"
  | "app.snapshots.evaluate"
  | "app.rollouts.request"
  | "app.rollouts.get"
  | "app.rollouts.resume"
  | "exchange.appCredential";

export interface ControlPlaneAdminAdapter {
  readonly apps: {
    create(input: ControlPlaneAppCreateInput): Promise<ControlPlaneApp>;
    get(appId: string): Promise<ControlPlaneApp>;
    update(
      appId: string,
      input: ControlPlaneAppUpdateInput,
    ): Promise<ControlPlaneApp>;
  };
  readonly releases: {
    create(
      appId: string,
      input: ControlPlaneReleaseCreateInput,
    ): Promise<ControlPlaneRelease>;
    get(appId: string, releaseId: string): Promise<ControlPlaneRelease>;
  };
  readonly installations: {
    apply(
      appId: string,
      vaultId: string,
      input: ControlPlaneInstallationCommandInput,
    ): Promise<ControlPlaneInstallation>;
    get(appId: string, vaultId: string): Promise<ControlPlaneInstallation>;
    uninstall(
      appId: string,
      vaultId: string,
    ): Promise<ControlPlaneInstallation>;
  };
  readonly inventory: {
    list(
      appId: string,
      options?: ControlPlaneListInventoryOptions,
    ): Promise<ControlPlaneInventory>;
    reportObserved(
      appId: string,
      input: ControlPlaneObservedStateInput,
    ): Promise<ControlPlaneObservedStateResult>;
  };
  readonly snapshots: {
    create(appId: string): Promise<ControlPlaneSnapshotCreate>;
    get(appId: string, snapshotId: string): Promise<ControlPlaneSnapshot>;
    evaluate(
      appId: string,
      snapshotId: string,
      targetId: string,
    ): Promise<ControlPlaneEligibility>;
  };
  readonly rollouts: {
    request(
      appId: string,
      input: ControlPlaneRolloutInput,
      idempotencyKey: string,
    ): Promise<ControlPlaneRollout>;
    get(appId: string, rolloutId: string): Promise<ControlPlaneRollout>;
    resume(
      appId: string,
      rolloutId: string,
      input: ControlPlaneRolloutInput,
      idempotencyKey: string,
    ): Promise<ControlPlaneRollout>;
  };
}

export interface ControlPlaneAppAdapter {
  readonly authorize: (
    input: ControlPlaneAuthorizeInput,
  ) => Promise<ControlPlaneAuthorize>;
  readonly installations: {
    get(vaultId: string): Promise<ControlPlaneInstallation>;
  };
  readonly inventory: {
    list(
      options?: ControlPlaneListInventoryOptions,
    ): Promise<ControlPlaneInventory>;
    reportObserved(
      input: ControlPlaneObservedStateInput,
    ): Promise<ControlPlaneObservedStateResult>;
  };
  readonly snapshots: {
    create(): Promise<ControlPlaneSnapshotCreate>;
    get(snapshotId: string): Promise<ControlPlaneSnapshot>;
    evaluate(
      snapshotId: string,
      targetId: string,
    ): Promise<ControlPlaneEligibility>;
  };
  readonly rollouts: {
    request(
      input: ControlPlaneRolloutInput,
      idempotencyKey: string,
    ): Promise<ControlPlaneRollout>;
    get(rolloutId: string): Promise<ControlPlaneRollout>;
    resume(
      rolloutId: string,
      input: ControlPlaneRolloutInput,
      idempotencyKey: string,
    ): Promise<ControlPlaneRollout>;
  };
}

const IdempotencyKeySchema = z.string().min(1).max(256);
const BaseUrlSchema = z.string().trim().min(1);

/* Private snake_case wire schemas. Unknown fields are stripped at this boundary. */
const WireReleaseReferenceSchema = z.object({
  id: ControlPlaneIdSchema.nullable().optional(),
  version: z.string().min(1).nullable().optional(),
});
const WireGrantSchema = z.object({
  generation: z.number().int().nonnegative(),
  status: z.enum(["active", "revoked"]),
  capabilities: z.array(z.string()),
});
const WireObservedSchema = z.object({
  generation: z.number().int().nonnegative(),
  observed_at: z.string().min(1).nullable().optional(),
  release: WireReleaseReferenceSchema.nullable().optional(),
  schema_fingerprint: z.string().min(1).nullable().optional(),
  grant_generation: z.number().int().nonnegative().nullable().optional(),
  checkpoint: ControlPlaneJsonObjectSchema,
  recent_error: ControlPlaneJsonObjectSchema.nullable().optional(),
});
const WireOwnedResourceSchema = z.object({
  kind: z.string().min(1),
  key: z.string().min(1),
  status: z.enum(["owned", "retained"]),
});
const WireDriftDimensionSchema = z.object({
  status: z.enum(["in_sync", "mismatch", "unknown"]),
  expected: ControlPlaneJsonValueSchema.optional(),
  actual: ControlPlaneJsonValueSchema.optional(),
});
const WireDriftSchema = z.object({
  release: WireDriftDimensionSchema,
  schema: WireDriftDimensionSchema,
  grant: WireDriftDimensionSchema,
  overall: z.enum(["in_sync", "drifted", "unknown"]),
  reasons: z.array(z.string()),
  unknown_dimensions: z.array(z.string()),
});
const WireInstallationSchema = z.object({
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
  blocked_reason: z.string().min(1).nullable().optional(),
  desired_release: WireReleaseReferenceSchema.nullable().optional(),
  current_release: WireReleaseReferenceSchema.nullable().optional(),
  observed: WireObservedSchema.nullable().optional(),
  desired_grant_generation: z.number().int().nonnegative().optional(),
  latest_grant: WireGrantSchema.nullable().optional(),
  active_grant: WireGrantSchema.nullable().optional(),
  owned_resources: z.array(WireOwnedResourceSchema).optional(),
  checkpoint: ControlPlaneJsonObjectSchema.optional(),
  recent_error: ControlPlaneJsonObjectSchema.nullable().optional(),
  drift: WireDriftSchema.nullable().optional(),
  drift_classification: WireDriftSchema.nullable().optional(),
  created_at: z.string().min(1).nullable().optional(),
  updated_at: z.string().min(1).nullable().optional(),
  command_status: z
    .enum(["accepted", "already_applied", "not_applicable"])
    .nullable()
    .optional(),
  replayed: z.boolean().nullable().optional(),
});
const WireInventoryItemSchema = z.object({
  installation_id: ControlPlaneIdSchema,
  app_id: ControlPlaneIdSchema,
  vault_id: ControlPlaneIdSchema,
  vault_name: z.string().min(1),
  lifecycle: WireInstallationSchema.shape.lifecycle,
  desired_release: WireReleaseReferenceSchema.nullable().optional(),
  current_release: WireReleaseReferenceSchema.nullable().optional(),
  observed: WireObservedSchema.nullable().optional(),
  latest_grant: WireGrantSchema.nullable().optional(),
  latest_active_grant: WireGrantSchema.nullable().optional(),
  grant_generation: z.number().int().nonnegative(),
  checkpoint: ControlPlaneJsonObjectSchema,
  recent_error: ControlPlaneJsonObjectSchema.nullable().optional(),
  drift: WireDriftSchema,
  drift_classification: WireDriftSchema,
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});
const WireInventorySchema = z.object({
  items: z.array(WireInventoryItemSchema),
  next_cursor: z.string().min(1).nullable().optional(),
});
const WireSnapshotCreateSchema = z.object({
  snapshot_id: ControlPlaneIdSchema,
  app_id: ControlPlaneIdSchema.nullable().optional(),
  created_at: z.string().min(1).nullable().optional(),
  sealed_at: z.string().min(1).nullable().optional(),
  requested_by_kind: z.enum(["admin", "app"]).nullable().optional(),
  target_count: z.number().int().nonnegative().optional(),
});
const WireSnapshotTargetSchema = z.object({
  target_id: ControlPlaneIdSchema,
  installation_id: ControlPlaneIdSchema,
  vault_id: ControlPlaneIdSchema,
  desired_release: WireReleaseReferenceSchema.nullable().optional(),
  current_release: WireReleaseReferenceSchema.nullable().optional(),
  baseline_grant_generation: z.number().int().nonnegative(),
  state: z.enum([
    "pending",
    "running",
    "denied",
    "skipped",
    "applied",
    "replayed",
  ]),
  reason_code: z.string().min(1).nullable().optional(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});
const WireSnapshotSchema = z.object({
  snapshot_id: ControlPlaneIdSchema,
  app_id: ControlPlaneIdSchema,
  created_at: z.string().min(1),
  sealed_at: z.string().min(1).nullable().optional(),
  requested_by_kind: z.enum(["admin", "app"]),
  target_count: z.number().int().nonnegative(),
  targets: z.array(WireSnapshotTargetSchema),
});
const WireEligibilitySchema = z.object({
  target_id: ControlPlaneIdSchema,
  eligible: z.boolean(),
  executed: z.boolean(),
  state: z.string().min(1),
  reason_code: z.string().min(1).nullable().optional(),
});
const WireRolloutStepSchema = z.object({
  step_id: z.string().min(1),
  operation: z.string().min(1),
  state: z.string().min(1),
  checkpoint: ControlPlaneJsonObjectSchema.optional(),
  reason: z.string().min(1).nullable().optional(),
});
const WireRolloutTargetSchema = z.object({
  target_id: ControlPlaneIdSchema,
  installation_id: ControlPlaneIdSchema,
  vault_id: ControlPlaneIdSchema,
  ordinal: z.number().int().nonnegative(),
  batch: z.number().int().nonnegative(),
  canary: z.boolean(),
  state: z.string().min(1),
  reason: z.string().min(1).nullable().optional(),
  steps: z.array(WireRolloutStepSchema),
});
const WireRolloutSchema = z.object({
  job_id: ControlPlaneIdSchema,
  app_id: ControlPlaneIdSchema.nullable().optional(),
  release_id: ControlPlaneIdSchema.nullable().optional(),
  manifest_checksum: z.string().min(1).nullable().optional(),
  snapshot_id: ControlPlaneIdSchema.nullable().optional(),
  status: z
    .enum(["pending", "running", "applied", "blocked"])
    .nullable()
    .optional(),
  blocked_reason: z.string().min(1).nullable().optional(),
  created_at: z.string().min(1).nullable().optional(),
  updated_at: z.string().min(1).nullable().optional(),
  completed_at: z.string().min(1).nullable().optional(),
  targets: z.array(WireRolloutTargetSchema),
  replayed: z.boolean().nullable().optional(),
  source_rollout_id: ControlPlaneIdSchema.nullable().optional(),
  resume_outcome: z
    .enum(["accepted", "replayed", "denied"])
    .nullable()
    .optional(),
  resume_reason: z.string().min(1).nullable().optional(),
});
const WireReleaseManifestSchema = z
  .object({ steps: z.array(ControlPlaneJsonObjectSchema) })
  .catchall(ControlPlaneJsonValueSchema);
const WireAppSchema = z.object({
  id: ControlPlaneIdSchema,
  app_key: z.string().min(1),
  display_name: z.string().min(1).nullable().optional(),
  description: z.string().min(1).nullable().optional(),
  metadata: ControlPlaneJsonObjectSchema,
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  replayed: z.boolean().nullable().optional(),
});
const WireReleaseSchema = z.object({
  id: ControlPlaneIdSchema,
  app_id: ControlPlaneIdSchema,
  version: z.string().min(1),
  manifest: WireReleaseManifestSchema,
  manifest_checksum: z.string().min(1),
  registered_at: z.string().min(1),
  replayed: z.boolean().nullable().optional(),
});
const WireObservedStateResultSchema = z.object({
  accepted: z.boolean(),
  installation_id: ControlPlaneIdSchema,
  observed_generation: z.number().int().nonnegative(),
  observed_at: z.string().min(1),
});
const WireCredentialExchangeSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  expires_at: z.string().min(1),
  correlation_id: z.string().min(1),
});
const WireAuthorizeSchema = z.object({
  authorized: z.literal(true),
  correlation_id: z.string().min(1),
});
const WireErrorEnvelopeSchema = z.object({
  code: z.string().optional(),
  hint: z.string().nullable().optional(),
});

const WireAppCreateSchema = z.object({
  app_key: z.string().min(1),
  display_name: z.string().min(1).nullable().optional(),
  description: z.string().min(1).nullable().optional(),
  metadata: ControlPlaneJsonObjectSchema.optional(),
});
const WireAppUpdateSchema = z.object({
  display_name: z.string().min(1).nullable().optional(),
  description: z.string().min(1).nullable().optional(),
  metadata: ControlPlaneJsonObjectSchema.nullable().optional(),
});
const WireReleaseCreateSchema = z.object({
  version: z.string().min(1),
  manifest: WireReleaseManifestSchema,
  manifest_checksum: z.string().min(1),
});
const WireInstallationCommandSchema = z.object({
  release_id: ControlPlaneIdSchema,
  capabilities: z.array(z.string().min(1)),
  mode: z.enum(["install", "restore", "fresh"]).optional(),
});
const WireObservedStateSchema = z.object({
  installation_id: ControlPlaneIdSchema,
  observed_generation: z.number().int().nonnegative(),
  observed_at: z.string().min(1).nullable().optional(),
  observed_release_id: ControlPlaneIdSchema.nullable().optional(),
  observed_release_version: z.string().min(1).nullable().optional(),
  schema_fingerprint: z.string().min(1).nullable().optional(),
  observed_grant_generation: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional(),
  checkpoint: ControlPlaneJsonObjectSchema.optional(),
  recent_error: ControlPlaneJsonObjectSchema.nullable().optional(),
});
const WireRolloutRequestSchema = z.object({
  release_id: ControlPlaneIdSchema,
  manifest_checksum: z.string().min(1),
});
const WireAuthorizeRequestSchema = z.object({
  vault_id: ControlPlaneIdSchema,
  capability: z.string().min(1),
  resource_kind: z.string().min(1).nullable().optional(),
  resource_key: z.string().min(1).nullable().optional(),
});
const WireCredentialExchangeRequestSchema = z.object({
  credential: z.string().min(1),
});

type WireApp = z.infer<typeof WireAppSchema>;
type WireRelease = z.infer<typeof WireReleaseSchema>;
type WireInstallation = z.infer<typeof WireInstallationSchema>;
type WireInventory = z.infer<typeof WireInventorySchema>;
type WireObservedStateResult = z.infer<typeof WireObservedStateResultSchema>;
type WireSnapshotCreate = z.infer<typeof WireSnapshotCreateSchema>;
type WireSnapshot = z.infer<typeof WireSnapshotSchema>;
type WireEligibility = z.infer<typeof WireEligibilitySchema>;
type WireRollout = z.infer<typeof WireRolloutSchema>;
type WireCredentialExchange = z.infer<typeof WireCredentialExchangeSchema>;
type WireAuthorize = z.infer<typeof WireAuthorizeSchema>;
type WireAppCreate = z.infer<typeof WireAppCreateSchema>;
type WireAppUpdate = z.infer<typeof WireAppUpdateSchema>;
type WireReleaseCreate = z.infer<typeof WireReleaseCreateSchema>;
type WireInstallationCommand = z.infer<typeof WireInstallationCommandSchema>;
type WireObservedState = z.infer<typeof WireObservedStateSchema>;
type WireRolloutRequest = z.infer<typeof WireRolloutRequestSchema>;
type WireAuthorizeRequest = z.infer<typeof WireAuthorizeRequestSchema>;
type WireCredentialExchangeRequest = z.infer<
  typeof WireCredentialExchangeRequestSchema
>;

type DirectHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface DirectRequest {
  method: DirectHttpMethod;
  path: string;
  query?: Record<string, string | number | null | undefined>;
  body?: unknown;
  idempotencyKey?: string;
}
interface DirectResponse<T> {
  status: number;
  body: T;
}
type DirectRequester = <T>(
  request: DirectRequest,
  schema: z.ZodType<T>,
) => Promise<DirectResponse<T>>;

const DEFAULT_REQUEST_POLICY: ControlPlaneRequestPolicy = {
  timeoutMs: 10_000,
  maxJsonResponseBytes: 2_000_000,
};

class DirectTransportError extends Error {
  constructor() {
    super("control_plane_transport_failure");
    this.name = "DirectTransportError";
  }
}

class DirectHttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly hint: string | null | undefined;

  constructor(
    status: number,
    code: string | undefined,
    hint: string | null | undefined,
  ) {
    super("control_plane_http_failure");
    this.name = "DirectHttpError";
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

class DirectResponseError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("control_plane_invalid_response");
    this.name = "DirectResponseError";
    this.status = status;
  }
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

function normalizeBaseUrl(value: string): string {
  const base = stripTrailingSlashes(value.trim());
  return base.endsWith("/api/v1") ? base : `${base}/api/v1`;
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function buildDirectUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | null | undefined>,
): string {
  const pathPart = path.startsWith("/") ? path : `/${path}`;
  const url = `${baseUrl}${pathPart}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded.length > 0 ? `${url}?${encoded}` : url;
}

function createDirectRequester(
  rawBaseUrl: string,
  tokenSource: TokenSource | undefined,
  fetchImpl: typeof fetch | undefined,
  requestPolicy: ControlPlaneRequestPolicy | undefined,
): DirectRequester {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const policy = validateRequestPolicy(requestPolicy);
  const requestFetch = fetchImpl ?? fetch;
  return async <T>(request: DirectRequest, schema: z.ZodType<T>) => {
    const token =
      typeof tokenSource === "function" ? tokenSource() : tokenSource;
    const headers = new Headers({ Accept: "application/json" });
    if (token && token.trim().length > 0) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (request.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (request.idempotencyKey !== undefined) {
      headers.set("Idempotency-Key", request.idempotencyKey);
    }
    let response: Response;
    try {
      response = await requestFetch(
        buildDirectUrl(baseUrl, request.path, request.query),
        {
          method: request.method,
          headers,
          ...(request.body !== undefined
            ? { body: JSON.stringify(request.body) }
            : {}),
          redirect: request.method === "GET" ? "follow" : "manual",
          signal: AbortSignal.timeout(policy.timeoutMs),
        },
      );
    } catch {
      throw new DirectTransportError();
    }

    if (!response.ok) {
      let envelope: z.infer<typeof WireErrorEnvelopeSchema> = {};
      try {
        const body = await readAkbJsonBody(response, {
          maxBytes: policy.maxJsonResponseBytes,
          signal: AbortSignal.timeout(policy.timeoutMs),
        });
        const parsed = WireErrorEnvelopeSchema.safeParse(body);
        if (parsed.success) envelope = parsed.data;
      } catch {
        // Error response details are optional and never needed for status mapping.
      }
      throw new DirectHttpError(response.status, envelope.code, envelope.hint);
    }
    if (response.status === 204) {
      throw new DirectResponseError(response.status);
    }
    try {
      const body = await readAkbJsonBody(response, {
        maxBytes: policy.maxJsonResponseBytes,
        signal: AbortSignal.timeout(policy.timeoutMs),
      });
      return { status: response.status, body: schema.parse(body) };
    } catch {
      throw new DirectResponseError(response.status);
    }
  };
}

type DirectResult<T> = Promise<DirectResponse<T>>;

interface ControlPlaneAdminClient {
  apps: {
    create(input: WireAppCreate): DirectResult<WireApp>;
    get(appId: string): DirectResult<WireApp>;
    update(appId: string, input: WireAppUpdate): DirectResult<WireApp>;
  };
  releases: {
    create(appId: string, input: WireReleaseCreate): DirectResult<WireRelease>;
    get(appId: string, releaseId: string): DirectResult<WireRelease>;
  };
  installations: {
    apply(
      appId: string,
      vaultId: string,
      input: WireInstallationCommand,
    ): DirectResult<WireInstallation>;
    get(appId: string, vaultId: string): DirectResult<WireInstallation>;
    uninstall(appId: string, vaultId: string): DirectResult<WireInstallation>;
  };
  inventory: {
    list(
      appId: string,
      options: ControlPlaneListInventoryOptions,
    ): DirectResult<WireInventory>;
    reportObserved(
      appId: string,
      input: WireObservedState,
    ): DirectResult<WireObservedStateResult>;
  };
  snapshots: {
    create(appId: string): DirectResult<WireSnapshotCreate>;
    get(appId: string, snapshotId: string): DirectResult<WireSnapshot>;
    evaluate(
      appId: string,
      snapshotId: string,
      targetId: string,
    ): DirectResult<WireEligibility>;
  };
  rollouts: {
    request(
      appId: string,
      input: WireRolloutRequest,
      idempotencyKey: string,
    ): DirectResult<WireRollout>;
    get(appId: string, rolloutId: string): DirectResult<WireRollout>;
    resume(
      appId: string,
      rolloutId: string,
      input: WireRolloutRequest,
      idempotencyKey: string,
    ): DirectResult<WireRollout>;
  };
}

interface ControlPlaneAppClient {
  authorize(input: WireAuthorizeRequest): DirectResult<WireAuthorize>;
  installations: {
    get(vaultId: string): DirectResult<WireInstallation>;
  };
  inventory: {
    list(
      options: ControlPlaneListInventoryOptions,
    ): DirectResult<WireInventory>;
    reportObserved(
      input: WireObservedState,
    ): DirectResult<WireObservedStateResult>;
  };
  snapshots: {
    create(): DirectResult<WireSnapshotCreate>;
    get(snapshotId: string): DirectResult<WireSnapshot>;
    evaluate(
      snapshotId: string,
      targetId: string,
    ): DirectResult<WireEligibility>;
  };
  rollouts: {
    request(
      input: WireRolloutRequest,
      idempotencyKey: string,
    ): DirectResult<WireRollout>;
    get(rolloutId: string): DirectResult<WireRollout>;
    resume(
      rolloutId: string,
      input: WireRolloutRequest,
      idempotencyKey: string,
    ): DirectResult<WireRollout>;
  };
}

function createControlPlaneAdminClient(config: {
  baseUrl: string;
  adminToken: TokenSource;
  fetch?: typeof fetch;
  requestPolicy?: ControlPlaneRequestPolicy;
}): ControlPlaneAdminClient {
  const request = createDirectRequester(
    config.baseUrl,
    config.adminToken,
    config.fetch,
    config.requestPolicy,
  );
  return {
    apps: {
      create: (input) =>
        request({ method: "POST", path: "/apps", body: input }, WireAppSchema),
      get: (appId) =>
        request(
          { method: "GET", path: `/apps/${encodePath(appId)}` },
          WireAppSchema,
        ),
      update: (appId, input) =>
        request(
          { method: "PATCH", path: `/apps/${encodePath(appId)}`, body: input },
          WireAppSchema,
        ),
    },
    releases: {
      create: (appId, input) =>
        request(
          {
            method: "POST",
            path: `/apps/${encodePath(appId)}/releases`,
            body: input,
          },
          WireReleaseSchema,
        ),
      get: (appId, releaseId) =>
        request(
          {
            method: "GET",
            path: `/apps/${encodePath(appId)}/releases/${encodePath(releaseId)}`,
          },
          WireReleaseSchema,
        ),
    },
    installations: {
      apply: (appId, vaultId, input) =>
        request(
          {
            method: "PUT",
            path: `/apps/${encodePath(appId)}/installations/${encodePath(vaultId)}`,
            body: input,
          },
          WireInstallationSchema,
        ),
      get: (appId, vaultId) =>
        request(
          {
            method: "GET",
            path: `/apps/${encodePath(appId)}/installations/${encodePath(vaultId)}`,
          },
          WireInstallationSchema,
        ),
      uninstall: (appId, vaultId) =>
        request(
          {
            method: "DELETE",
            path: `/apps/${encodePath(appId)}/installations/${encodePath(vaultId)}`,
          },
          WireInstallationSchema,
        ),
    },
    inventory: {
      list: (appId, options) =>
        request(
          {
            method: "GET",
            path: `/apps/${encodePath(appId)}/inventory`,
            query: options,
          },
          WireInventorySchema,
        ),
      reportObserved: (appId, input) =>
        request(
          {
            method: "POST",
            path: `/apps/${encodePath(appId)}/observed-state`,
            body: input,
          },
          WireObservedStateResultSchema,
        ),
    },
    snapshots: {
      create: (appId) =>
        request(
          {
            method: "POST",
            path: `/apps/${encodePath(appId)}/rollout-snapshots`,
          },
          WireSnapshotCreateSchema,
        ),
      get: (appId, snapshotId) =>
        request(
          {
            method: "GET",
            path: `/apps/${encodePath(appId)}/rollout-snapshots/${encodePath(snapshotId)}`,
          },
          WireSnapshotSchema,
        ),
      evaluate: (appId, snapshotId, targetId) =>
        request(
          {
            method: "POST",
            path: `/apps/${encodePath(appId)}/rollout-snapshots/${encodePath(snapshotId)}/targets/${encodePath(targetId)}/eligibility`,
          },
          WireEligibilitySchema,
        ),
    },
    rollouts: {
      request: (appId, input, idempotencyKey) =>
        request(
          {
            method: "POST",
            path: `/apps/${encodePath(appId)}/rollouts`,
            body: input,
            idempotencyKey,
          },
          WireRolloutSchema,
        ),
      get: (appId, rolloutId) =>
        request(
          {
            method: "GET",
            path: `/apps/${encodePath(appId)}/rollouts/${encodePath(rolloutId)}`,
          },
          WireRolloutSchema,
        ),
      resume: (appId, rolloutId, input, idempotencyKey) =>
        request(
          {
            method: "POST",
            path: `/apps/${encodePath(appId)}/rollouts/${encodePath(rolloutId)}/resume`,
            body: input,
            idempotencyKey,
          },
          WireRolloutSchema,
        ),
    },
  };
}

function createControlPlaneAppClient(config: {
  baseUrl: string;
  appToken: TokenSource;
  fetch?: typeof fetch;
  requestPolicy?: ControlPlaneRequestPolicy;
}): ControlPlaneAppClient {
  const request = createDirectRequester(
    config.baseUrl,
    config.appToken,
    config.fetch,
    config.requestPolicy,
  );
  return {
    authorize: (input) =>
      request(
        { method: "POST", path: "/app/authorize", body: input },
        WireAuthorizeSchema,
      ),
    installations: {
      get: (vaultId) =>
        request(
          { method: "GET", path: `/app/installations/${encodePath(vaultId)}` },
          WireInstallationSchema,
        ),
    },
    inventory: {
      list: (options) =>
        request(
          { method: "GET", path: "/app/inventory", query: options },
          WireInventorySchema,
        ),
      reportObserved: (input) =>
        request(
          { method: "POST", path: "/app/observed-state", body: input },
          WireObservedStateResultSchema,
        ),
    },
    snapshots: {
      create: () =>
        request(
          { method: "POST", path: "/app/rollout-snapshots" },
          WireSnapshotCreateSchema,
        ),
      get: (snapshotId) =>
        request(
          {
            method: "GET",
            path: `/app/rollout-snapshots/${encodePath(snapshotId)}`,
          },
          WireSnapshotSchema,
        ),
      evaluate: (snapshotId, targetId) =>
        request(
          {
            method: "POST",
            path: `/app/rollout-snapshots/${encodePath(snapshotId)}/targets/${encodePath(targetId)}/eligibility`,
          },
          WireEligibilitySchema,
        ),
    },
    rollouts: {
      request: (input, idempotencyKey) =>
        request(
          {
            method: "POST",
            path: "/app/rollouts",
            body: input,
            idempotencyKey,
          },
          WireRolloutSchema,
        ),
      get: (rolloutId) =>
        request(
          { method: "GET", path: `/app/rollouts/${encodePath(rolloutId)}` },
          WireRolloutSchema,
        ),
      resume: (rolloutId, input, idempotencyKey) =>
        request(
          {
            method: "POST",
            path: `/app/rollouts/${encodePath(rolloutId)}/resume`,
            body: input,
            idempotencyKey,
          },
          WireRolloutSchema,
        ),
    },
  };
}

export function createControlPlaneAdminAdapter(
  config: ControlPlaneAdminAdapterConfig,
): ControlPlaneAdminAdapter {
  const baseUrl = parseValue(BaseUrlSchema, config.baseUrl, "baseUrl");
  const adminToken = validateTokenSource(config.adminToken, "adminToken");
  const client = createControlPlaneAdminClient({
    ...config,
    baseUrl,
    adminToken,
  });
  return Object.freeze({
    apps: Object.freeze({
      create: (input: ControlPlaneAppCreateInput) =>
        execute(
          "admin.apps.create",
          "admin",
          () =>
            client.apps.create(
              toWireAppCreate(
                parseValue(ControlPlaneAppCreateInputSchema, input, "app"),
              ),
            ),
          mapApp,
          ControlPlaneAppSchema,
          undefined,
          () => parseValue(ControlPlaneAppCreateInputSchema, input, "app"),
        ),
      get: (appId: string) =>
        execute(
          "admin.apps.get",
          "admin",
          () => client.apps.get(parseId(appId, "appId")),
          mapApp,
          ControlPlaneAppSchema,
          undefined,
          () => parseId(appId, "appId"),
        ),
      update: (appId: string, input: ControlPlaneAppUpdateInput) =>
        execute(
          "admin.apps.update",
          "admin",
          () =>
            client.apps.update(
              parseId(appId, "appId"),
              toWireAppUpdate(
                parseValue(ControlPlaneAppUpdateInputSchema, input, "app"),
              ),
            ),
          mapApp,
          ControlPlaneAppSchema,
          undefined,
          () => {
            parseId(appId, "appId");
            parseValue(ControlPlaneAppUpdateInputSchema, input, "app");
          },
        ),
    }),
    releases: Object.freeze({
      create: (appId: string, input: ControlPlaneReleaseCreateInput) =>
        execute(
          "admin.releases.create",
          "admin",
          () =>
            client.releases.create(
              parseId(appId, "appId"),
              toWireReleaseCreate(
                parseValue(
                  ControlPlaneReleaseCreateInputSchema,
                  input,
                  "release",
                ),
              ),
            ),
          mapRelease,
          ControlPlaneReleaseSchema,
          undefined,
          () => {
            parseId(appId, "appId");
            parseValue(ControlPlaneReleaseCreateInputSchema, input, "release");
          },
        ),
      get: (appId: string, releaseId: string) =>
        execute(
          "admin.releases.get",
          "admin",
          () =>
            client.releases.get(
              parseId(appId, "appId"),
              parseId(releaseId, "releaseId"),
            ),
          mapRelease,
          ControlPlaneReleaseSchema,
          undefined,
          () => {
            parseId(appId, "appId");
            parseId(releaseId, "releaseId");
          },
        ),
    }),
    installations: Object.freeze({
      apply: (
        appId: string,
        vaultId: string,
        input: ControlPlaneInstallationCommandInput,
      ) =>
        execute(
          "admin.installations.apply",
          "admin",
          () =>
            client.installations.apply(
              parseId(appId, "appId"),
              parseId(vaultId, "vaultId"),
              toWireInstallationCommand(
                parseValue(
                  ControlPlaneInstallationCommandInputSchema,
                  input,
                  "installation",
                ),
              ),
            ),
          mapInstallation,
          ControlPlaneInstallationSchema,
          installationFields,
          () => {
            parseId(appId, "appId");
            parseId(vaultId, "vaultId");
            parseValue(
              ControlPlaneInstallationCommandInputSchema,
              input,
              "installation",
            );
          },
        ),
      get: (appId: string, vaultId: string) =>
        execute(
          "admin.installations.get",
          "admin",
          () =>
            client.installations.get(
              parseId(appId, "appId"),
              parseId(vaultId, "vaultId"),
            ),
          mapInstallation,
          ControlPlaneInstallationSchema,
          installationFields,
          () => {
            parseId(appId, "appId");
            parseId(vaultId, "vaultId");
          },
        ),
      uninstall: (appId: string, vaultId: string) =>
        execute(
          "admin.installations.uninstall",
          "admin",
          () =>
            client.installations.uninstall(
              parseId(appId, "appId"),
              parseId(vaultId, "vaultId"),
            ),
          mapInstallation,
          ControlPlaneInstallationSchema,
          installationFields,
          () => {
            parseId(appId, "appId");
            parseId(vaultId, "vaultId");
          },
        ),
    }),
    inventory: Object.freeze({
      list: (appId: string, options?: ControlPlaneListInventoryOptions) =>
        execute(
          "admin.inventory.list",
          "admin",
          () =>
            client.inventory.list(
              parseId(appId, "appId"),
              parseValue(
                ControlPlaneListInventoryOptionsSchema,
                options ?? {},
                "inventory",
              ),
            ),
          mapInventory,
          ControlPlaneInventorySchema,
          (value) => ({ "control_plane.item_count": value.items.length }),
          () => {
            parseId(appId, "appId");
            parseValue(
              ControlPlaneListInventoryOptionsSchema,
              options ?? {},
              "inventory",
            );
          },
        ),
      reportObserved: (appId: string, input: ControlPlaneObservedStateInput) =>
        execute(
          "admin.inventory.reportObserved",
          "admin",
          () =>
            client.inventory.reportObserved(
              parseId(appId, "appId"),
              toWireObservedState(
                parseValue(
                  ControlPlaneObservedStateInputSchema,
                  input,
                  "observedState",
                ),
              ),
            ),
          mapObservedStateResult,
          ControlPlaneObservedStateResultSchema,
          undefined,
          () => {
            parseId(appId, "appId");
            parseValue(
              ControlPlaneObservedStateInputSchema,
              input,
              "observedState",
            );
          },
        ),
    }),
    snapshots: Object.freeze({
      create: (appId: string) =>
        execute(
          "admin.snapshots.create",
          "admin",
          () => client.snapshots.create(parseId(appId, "appId")),
          mapSnapshotCreate,
          ControlPlaneSnapshotCreateSchema,
          undefined,
          () => parseId(appId, "appId"),
        ),
      get: (appId: string, snapshotId: string) =>
        execute(
          "admin.snapshots.get",
          "admin",
          () =>
            client.snapshots.get(
              parseId(appId, "appId"),
              parseId(snapshotId, "snapshotId"),
            ),
          mapSnapshot,
          ControlPlaneSnapshotSchema,
          (value) => ({ "control_plane.item_count": value.targets.length }),
          () => {
            parseId(appId, "appId");
            parseId(snapshotId, "snapshotId");
          },
        ),
      evaluate: (appId: string, snapshotId: string, targetId: string) =>
        execute(
          "admin.snapshots.evaluate",
          "admin",
          () =>
            client.snapshots.evaluate(
              parseId(appId, "appId"),
              parseId(snapshotId, "snapshotId"),
              parseId(targetId, "targetId"),
            ),
          mapEligibility,
          ControlPlaneEligibilitySchema,
          undefined,
          () => {
            parseId(appId, "appId");
            parseId(snapshotId, "snapshotId");
            parseId(targetId, "targetId");
          },
        ),
    }),
    rollouts: Object.freeze({
      request: (
        appId: string,
        input: ControlPlaneRolloutInput,
        idempotencyKey: string,
      ) =>
        execute(
          "admin.rollouts.request",
          "admin",
          () =>
            client.rollouts.request(
              parseId(appId, "appId"),
              toWireRollout(
                parseValue(ControlPlaneRolloutInputSchema, input, "rollout"),
              ),
              parseValue(
                IdempotencyKeySchema,
                idempotencyKey,
                "idempotencyKey",
              ),
            ),
          mapRollout,
          ControlPlaneRolloutSchema,
          rolloutFields,
          () => {
            parseId(appId, "appId");
            parseValue(ControlPlaneRolloutInputSchema, input, "rollout");
            parseValue(IdempotencyKeySchema, idempotencyKey, "idempotencyKey");
          },
        ),
      get: (appId: string, rolloutId: string) =>
        execute(
          "admin.rollouts.get",
          "admin",
          () =>
            client.rollouts.get(
              parseId(appId, "appId"),
              parseId(rolloutId, "rolloutId"),
            ),
          mapRollout,
          ControlPlaneRolloutSchema,
          rolloutFields,
          () => {
            parseId(appId, "appId");
            parseId(rolloutId, "rolloutId");
          },
        ),
      resume: (
        appId: string,
        rolloutId: string,
        input: ControlPlaneRolloutInput,
        idempotencyKey: string,
      ) =>
        execute(
          "admin.rollouts.resume",
          "admin",
          () =>
            client.rollouts.resume(
              parseId(appId, "appId"),
              parseId(rolloutId, "rolloutId"),
              toWireRollout(
                parseValue(ControlPlaneRolloutInputSchema, input, "rollout"),
              ),
              parseValue(
                IdempotencyKeySchema,
                idempotencyKey,
                "idempotencyKey",
              ),
            ),
          mapRollout,
          ControlPlaneRolloutSchema,
          rolloutFields,
          () => {
            parseId(appId, "appId");
            parseId(rolloutId, "rolloutId");
            parseValue(ControlPlaneRolloutInputSchema, input, "rollout");
            parseValue(IdempotencyKeySchema, idempotencyKey, "idempotencyKey");
          },
        ),
    }),
  });
}

export function createControlPlaneAppAdapter(
  config: ControlPlaneAppAdapterConfig,
): ControlPlaneAppAdapter {
  const baseUrl = parseValue(BaseUrlSchema, config.baseUrl, "baseUrl");
  const appToken = validateTokenSource(config.appToken, "appToken");
  const client = createControlPlaneAppClient({ ...config, baseUrl, appToken });
  return Object.freeze({
    authorize: (input: ControlPlaneAuthorizeInput) =>
      execute(
        "app.authorize",
        "app",
        () =>
          client.authorize(
            toWireAuthorize(
              parseValue(ControlPlaneAuthorizeInputSchema, input, "authorize"),
            ),
          ),
        mapAuthorize,
        ControlPlaneAuthorizeSchema,
        undefined,
        () => parseValue(ControlPlaneAuthorizeInputSchema, input, "authorize"),
      ),
    installations: Object.freeze({
      get: (vaultId: string) =>
        execute(
          "app.installations.get",
          "app",
          () => client.installations.get(parseId(vaultId, "vaultId")),
          mapInstallation,
          ControlPlaneInstallationSchema,
          installationFields,
          () => parseId(vaultId, "vaultId"),
        ),
    }),
    inventory: Object.freeze({
      list: (options?: ControlPlaneListInventoryOptions) =>
        execute(
          "app.inventory.list",
          "app",
          () =>
            client.inventory.list(
              parseValue(
                ControlPlaneListInventoryOptionsSchema,
                options ?? {},
                "inventory",
              ),
            ),
          mapInventory,
          ControlPlaneInventorySchema,
          (value) => ({ "control_plane.item_count": value.items.length }),
          () =>
            parseValue(
              ControlPlaneListInventoryOptionsSchema,
              options ?? {},
              "inventory",
            ),
        ),
      reportObserved: (input: ControlPlaneObservedStateInput) =>
        execute(
          "app.inventory.reportObserved",
          "app",
          () =>
            client.inventory.reportObserved(
              toWireObservedState(
                parseValue(
                  ControlPlaneObservedStateInputSchema,
                  input,
                  "observedState",
                ),
              ),
            ),
          mapObservedStateResult,
          ControlPlaneObservedStateResultSchema,
          undefined,
          () =>
            parseValue(
              ControlPlaneObservedStateInputSchema,
              input,
              "observedState",
            ),
        ),
    }),
    snapshots: Object.freeze({
      create: () =>
        execute(
          "app.snapshots.create",
          "app",
          () => client.snapshots.create(),
          mapSnapshotCreate,
          ControlPlaneSnapshotCreateSchema,
        ),
      get: (snapshotId: string) =>
        execute(
          "app.snapshots.get",
          "app",
          () => client.snapshots.get(parseId(snapshotId, "snapshotId")),
          mapSnapshot,
          ControlPlaneSnapshotSchema,
          (value) => ({ "control_plane.item_count": value.targets.length }),
          () => parseId(snapshotId, "snapshotId"),
        ),
      evaluate: (snapshotId: string, targetId: string) =>
        execute(
          "app.snapshots.evaluate",
          "app",
          () =>
            client.snapshots.evaluate(
              parseId(snapshotId, "snapshotId"),
              parseId(targetId, "targetId"),
            ),
          mapEligibility,
          ControlPlaneEligibilitySchema,
          undefined,
          () => {
            parseId(snapshotId, "snapshotId");
            parseId(targetId, "targetId");
          },
        ),
    }),
    rollouts: Object.freeze({
      request: (input: ControlPlaneRolloutInput, idempotencyKey: string) =>
        execute(
          "app.rollouts.request",
          "app",
          () =>
            client.rollouts.request(
              toWireRollout(
                parseValue(ControlPlaneRolloutInputSchema, input, "rollout"),
              ),
              parseValue(
                IdempotencyKeySchema,
                idempotencyKey,
                "idempotencyKey",
              ),
            ),
          mapRollout,
          ControlPlaneRolloutSchema,
          rolloutFields,
          () => {
            parseValue(ControlPlaneRolloutInputSchema, input, "rollout");
            parseValue(IdempotencyKeySchema, idempotencyKey, "idempotencyKey");
          },
        ),
      get: (rolloutId: string) =>
        execute(
          "app.rollouts.get",
          "app",
          () => client.rollouts.get(parseId(rolloutId, "rolloutId")),
          mapRollout,
          ControlPlaneRolloutSchema,
          rolloutFields,
          () => parseId(rolloutId, "rolloutId"),
        ),
      resume: (
        rolloutId: string,
        input: ControlPlaneRolloutInput,
        idempotencyKey: string,
      ) =>
        execute(
          "app.rollouts.resume",
          "app",
          () =>
            client.rollouts.resume(
              parseId(rolloutId, "rolloutId"),
              toWireRollout(
                parseValue(ControlPlaneRolloutInputSchema, input, "rollout"),
              ),
              parseValue(
                IdempotencyKeySchema,
                idempotencyKey,
                "idempotencyKey",
              ),
            ),
          mapRollout,
          ControlPlaneRolloutSchema,
          rolloutFields,
          () => {
            parseId(rolloutId, "rolloutId");
            parseValue(ControlPlaneRolloutInputSchema, input, "rollout");
            parseValue(IdempotencyKeySchema, idempotencyKey, "idempotencyKey");
          },
        ),
    }),
  });
}

export function exchangeControlPlaneCredential(
  config: ControlPlaneCredentialExchangeConfig,
): Promise<ControlPlaneCredentialExchange> {
  const baseUrl = parseValue(BaseUrlSchema, config.baseUrl, "baseUrl");
  const input = parseValue(
    ControlPlaneCredentialExchangeInputSchema,
    { credential: config.credential },
    "credential",
  );
  return execute(
    "exchange.appCredential",
    "exchange",
    () => {
      const request = createDirectRequester(
        baseUrl,
        undefined,
        config.fetch,
        config.requestPolicy,
      );
      return request(
        {
          method: "POST",
          path: "/auth/app-token",
          body: toWireCredentialExchange(input.credential),
        },
        WireCredentialExchangeSchema,
      );
    },
    mapCredentialExchange,
    ControlPlaneCredentialExchangeSchema,
  );
}

type ProjectionSchema<T> = z.ZodType<T>;
type ProjectionMapper<T, R> = (data: T) => R;
type ResultFields<R> = (value: R) => ObserveFields;

async function execute<T, R>(
  operation: ControlPlaneOperation,
  actorMode: ControlPlaneActorMode,
  call: () => DirectResult<T>,
  project: ProjectionMapper<T, R>,
  schema: ProjectionSchema<R>,
  resultFields?: ResultFields<R>,
  validate?: () => void,
): Promise<R> {
  validate?.();
  return withSpan(
    `akb.control_plane.${operation}`,
    {
      "control_plane.operation": operation,
      "control_plane.actor_mode": actorMode,
    },
    async (span) => {
      const startedAt = Date.now();
      let fields: ObserveFields = {};
      let level: "info" | "warn" = "info";
      try {
        let result: Awaited<DirectResult<T>>;
        try {
          result = await call();
        } catch (caught) {
          const error = mapDirectError(caught, operation);
          fields = errorFields(error);
          level = "warn";
          throw error;
        }
        let projected: R;
        try {
          projected = schema.parse(project(result.body));
        } catch {
          const error = newControlPlaneError({
            category: "invalid_response",
            operation,
            upstreamStatus: result.status,
            httpStatus: 502,
            retryable: true,
            upstreamCode: "invalid_response",
          });
          fields = errorFields(error);
          level = "warn";
          throw error;
        }
        fields = {
          "control_plane.upstream_status": result.status,
          ...replayFields(projected),
          ...(resultFields?.(projected) ?? {}),
        };
        return projected;
      } finally {
        observe(
          span,
          {
            "control_plane.operation": operation,
            "control_plane.actor_mode": actorMode,
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

function mapDirectError(
  value: unknown,
  operation: ControlPlaneOperation,
): ControlPlaneError {
  if (value instanceof ControlPlaneError) return value;
  if (value instanceof DirectHttpError) {
    return newControlPlaneError({
      ...classifyStatus(value.status),
      operation,
      upstreamCode: safeCode(value.code),
      hint: safeHint(value.hint),
    });
  }
  if (value instanceof DirectTransportError) {
    return newControlPlaneError({
      category: "transport",
      operation,
      upstreamStatus: 0,
      httpStatus: 503,
      retryable: true,
      upstreamCode: "transport_error",
    });
  }
  const status = value instanceof DirectResponseError ? value.status : 502;
  return newControlPlaneError({
    category: "invalid_response",
    operation,
    upstreamStatus: status,
    httpStatus: 502,
    retryable: true,
    upstreamCode: "invalid_response",
  });
}

function classifyStatus(status: number): {
  category: ControlPlaneErrorCategory;
  httpStatus: number;
  retryable: boolean;
  upstreamStatus: number;
} {
  const upstreamStatus = Number.isInteger(status) && status >= 0 ? status : 0;
  if (upstreamStatus === 401)
    return {
      category: "authentication",
      httpStatus: 401,
      retryable: false,
      upstreamStatus,
    };
  if (upstreamStatus === 403)
    return {
      category: "authorization",
      httpStatus: 403,
      retryable: false,
      upstreamStatus,
    };
  if (upstreamStatus === 404)
    return {
      category: "not_found",
      httpStatus: 404,
      retryable: false,
      upstreamStatus,
    };
  if (upstreamStatus === 409)
    return {
      category: "conflict",
      httpStatus: 409,
      retryable: false,
      upstreamStatus,
    };
  if (upstreamStatus === 400 || upstreamStatus === 422) {
    return {
      category: "invalid_argument",
      httpStatus: upstreamStatus,
      retryable: false,
      upstreamStatus,
    };
  }
  if (upstreamStatus === 429)
    return {
      category: "rate_limited",
      httpStatus: 429,
      retryable: true,
      upstreamStatus,
    };
  if (upstreamStatus >= 500)
    return {
      category: "unavailable",
      httpStatus: 503,
      retryable: true,
      upstreamStatus,
    };
  return {
    category: "unknown",
    httpStatus: 502,
    retryable: false,
    upstreamStatus,
  };
}

function newControlPlaneError(
  context: ConstructorParameters<typeof ControlPlaneError>[0],
): ControlPlaneError {
  return new ControlPlaneError(context);
}

function errorFields(error: ControlPlaneError): ObserveFields {
  return {
    "control_plane.upstream_status": error.upstreamStatus,
    "control_plane.upstream_code": error.upstreamCode,
    "control_plane.retryable": error.retryable,
  };
}

function replayFields(value: unknown): ObserveFields {
  const record = value as {
    replayed?: unknown;
    commandStatus?: unknown;
    resumeOutcome?: unknown;
  };
  return {
    "control_plane.replayed":
      typeof record.replayed === "boolean" ? record.replayed : undefined,
    "control_plane.command_status":
      typeof record.commandStatus === "string"
        ? record.commandStatus
        : undefined,
    "control_plane.resume_outcome":
      typeof record.resumeOutcome === "string"
        ? record.resumeOutcome
        : undefined,
  };
}

function installationFields(value: ControlPlaneInstallation): ObserveFields {
  return {
    "control_plane.lifecycle": value.lifecycle,
    "control_plane.replayed": value.replayed ?? undefined,
  };
}

function rolloutFields(value: ControlPlaneRollout): ObserveFields {
  return {
    "control_plane.rollout_status": value.status ?? undefined,
    "control_plane.replayed": value.replayed ?? undefined,
    "control_plane.item_count": value.targets.length,
  };
}

function safeCode(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[a-z0-9_.:-]{1,80}$/iu.test(value)) {
    return undefined;
  }
  return value;
}

function safeHint(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    hasControlCharacters(value) ||
    /(authorization|bearer|token|credential|secret|password|api[ _-]?key|private[ _-]?key)/iu.test(
      value,
    )
  ) {
    return undefined;
  }
  return value;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function validateTokenSource(value: TokenSource, label: string): TokenSource {
  if (typeof value === "string" && value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  if (typeof value !== "string" && typeof value !== "function") {
    throw new TypeError(`${label} must be a token or token source`);
  }
  return value;
}

function parseId(value: string, field: string): string {
  return parseValue(ControlPlaneIdSchema, value, field);
}

function parseValue<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw callerValidationError(field, result.error);
}

function callerValidationError(
  field: string,
  error: z.ZodError,
): SchemaValidationError {
  return new SchemaValidationError({
    field,
    clientValidated: true,
    issues: error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`.slice(0, 256);
    }),
  });
}

function toWireAppCreate(input: ControlPlaneAppCreateInput): WireAppCreate {
  return WireAppCreateSchema.parse({
    app_key: input.appKey,
    ...(input.displayName !== undefined
      ? { display_name: input.displayName }
      : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
}

function toWireAppUpdate(input: ControlPlaneAppUpdateInput): WireAppUpdate {
  return WireAppUpdateSchema.parse({
    ...(input.displayName !== undefined
      ? { display_name: input.displayName }
      : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
}

function toWireReleaseCreate(
  input: ControlPlaneReleaseCreateInput,
): WireReleaseCreate {
  return WireReleaseCreateSchema.parse({
    version: input.version,
    manifest: input.manifest,
    manifest_checksum: input.manifestChecksum,
  });
}

function toWireInstallationCommand(
  input: ControlPlaneInstallationCommandInput,
): WireInstallationCommand {
  return WireInstallationCommandSchema.parse({
    release_id: input.releaseId,
    capabilities: input.capabilities,
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
  });
}

function toWireObservedState(
  input: ControlPlaneObservedStateInput,
): WireObservedState {
  return WireObservedStateSchema.parse({
    installation_id: input.installationId,
    observed_generation: input.observedGeneration,
    ...(input.observedAt !== undefined
      ? { observed_at: input.observedAt }
      : {}),
    ...(input.observedReleaseId !== undefined
      ? { observed_release_id: input.observedReleaseId }
      : {}),
    ...(input.observedReleaseVersion !== undefined
      ? { observed_release_version: input.observedReleaseVersion }
      : {}),
    ...(input.schemaFingerprint !== undefined
      ? { schema_fingerprint: input.schemaFingerprint }
      : {}),
    ...(input.observedGrantGeneration !== undefined
      ? { observed_grant_generation: input.observedGrantGeneration }
      : {}),
    ...(input.checkpoint !== undefined ? { checkpoint: input.checkpoint } : {}),
    ...(input.recentError !== undefined
      ? { recent_error: input.recentError }
      : {}),
  });
}

function toWireRollout(input: ControlPlaneRolloutInput): WireRolloutRequest {
  return WireRolloutRequestSchema.parse({
    release_id: input.releaseId,
    manifest_checksum: input.manifestChecksum,
  });
}

function toWireAuthorize(
  input: ControlPlaneAuthorizeInput,
): WireAuthorizeRequest {
  return WireAuthorizeRequestSchema.parse({
    vault_id: input.vaultId,
    capability: input.capability,
    ...(input.resourceKind !== undefined
      ? { resource_kind: input.resourceKind }
      : {}),
    ...(input.resourceKey !== undefined
      ? { resource_key: input.resourceKey }
      : {}),
  });
}

function toWireCredentialExchange(
  credential: string,
): WireCredentialExchangeRequest {
  return WireCredentialExchangeRequestSchema.parse({ credential });
}

function mapApp(value: WireApp): ControlPlaneApp {
  return {
    id: value.id,
    appKey: value.app_key,
    displayName: value.display_name,
    description: value.description,
    metadata: value.metadata,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    replayed: value.replayed,
  };
}

function mapRelease(value: WireRelease): ControlPlaneRelease {
  return {
    id: value.id,
    appId: value.app_id,
    version: value.version,
    manifest: value.manifest,
    manifestChecksum: value.manifest_checksum,
    registeredAt: value.registered_at,
    replayed: value.replayed,
  };
}

function mapReleaseReference(
  value: z.infer<typeof WireReleaseReferenceSchema> | null | undefined,
): z.infer<typeof ControlPlaneReleaseReferenceSchema> | null | undefined {
  if (value === undefined || value === null) return value;
  return {
    ...(value.id !== undefined ? { id: value.id } : {}),
    ...(value.version !== undefined ? { version: value.version } : {}),
  };
}

function mapGrant(
  value: z.infer<typeof WireGrantSchema> | null | undefined,
): z.infer<typeof ControlPlaneGrantSchema> | null | undefined {
  if (value === undefined || value === null) return value;
  return {
    generation: value.generation,
    status: value.status,
    capabilities: value.capabilities,
  };
}

function mapObserved(
  value: z.infer<typeof WireObservedSchema> | null | undefined,
): z.infer<typeof ControlPlaneObservedSchema> | null | undefined {
  if (value === undefined || value === null) return value;
  return {
    generation: value.generation,
    observedAt: value.observed_at,
    release: mapReleaseReference(value.release),
    schemaFingerprint: value.schema_fingerprint,
    grantGeneration: value.grant_generation,
    checkpoint: value.checkpoint,
    recentError: value.recent_error,
  };
}

function mapDrift(
  value: z.infer<typeof WireDriftSchema> | null | undefined,
): z.infer<typeof ControlPlaneDriftSchema> | null | undefined {
  if (value === undefined || value === null) return value;
  return {
    release: value.release,
    schema: value.schema,
    grant: value.grant,
    overall: value.overall,
    reasons: value.reasons,
    unknownDimensions: value.unknown_dimensions,
  };
}

function mapRequiredDrift(
  value: z.infer<typeof WireDriftSchema>,
): z.infer<typeof ControlPlaneDriftSchema> {
  const mapped = mapDrift(value);
  if (mapped === undefined || mapped === null) {
    throw new Error("control_plane_missing_drift");
  }
  return mapped;
}

function mapInstallation(value: WireInstallation): ControlPlaneInstallation {
  return {
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
    ownedResources: value.owned_resources,
    checkpoint: value.checkpoint,
    recentError: value.recent_error,
    drift: mapDrift(value.drift),
    driftClassification: mapDrift(value.drift_classification),
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    commandStatus: value.command_status,
    replayed: value.replayed,
  };
}

function mapInventory(value: WireInventory): ControlPlaneInventory {
  return {
    items: value.items.map((item) => ({
      installationId: item.installation_id,
      appId: item.app_id,
      vaultId: item.vault_id,
      vaultName: item.vault_name,
      lifecycle: item.lifecycle,
      desiredRelease: mapReleaseReference(item.desired_release),
      currentRelease: mapReleaseReference(item.current_release),
      observed: mapObserved(item.observed),
      latestGrant: mapGrant(item.latest_grant),
      latestActiveGrant: mapGrant(item.latest_active_grant),
      grantGeneration: item.grant_generation,
      checkpoint: item.checkpoint,
      recentError: item.recent_error,
      drift: mapRequiredDrift(item.drift),
      driftClassification: mapRequiredDrift(item.drift_classification),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
    nextCursor: value.next_cursor,
  };
}

function mapObservedStateResult(
  value: WireObservedStateResult,
): ControlPlaneObservedStateResult {
  return {
    accepted: value.accepted,
    installationId: value.installation_id,
    observedGeneration: value.observed_generation,
    observedAt: value.observed_at,
  };
}

function mapSnapshotCreate(
  value: WireSnapshotCreate,
): ControlPlaneSnapshotCreate {
  return {
    snapshotId: value.snapshot_id,
    appId: value.app_id,
    createdAt: value.created_at,
    sealedAt: value.sealed_at,
    requestedByKind: value.requested_by_kind,
    targetCount: value.target_count,
  };
}

function mapSnapshot(value: WireSnapshot): ControlPlaneSnapshot {
  return {
    snapshotId: value.snapshot_id,
    appId: value.app_id,
    createdAt: value.created_at,
    sealedAt: value.sealed_at,
    requestedByKind: value.requested_by_kind,
    targetCount: value.target_count,
    targets: value.targets.map((target) => ({
      targetId: target.target_id,
      installationId: target.installation_id,
      vaultId: target.vault_id,
      desiredRelease: mapReleaseReference(target.desired_release),
      currentRelease: mapReleaseReference(target.current_release),
      baselineGrantGeneration: target.baseline_grant_generation,
      state: target.state,
      reasonCode: target.reason_code,
      createdAt: target.created_at,
      updatedAt: target.updated_at,
    })),
  };
}

function mapEligibility(value: WireEligibility): ControlPlaneEligibility {
  return {
    targetId: value.target_id,
    eligible: value.eligible,
    executed: value.executed,
    state: value.state,
    reasonCode: value.reason_code,
  };
}

function mapRollout(value: WireRollout): ControlPlaneRollout {
  return {
    jobId: value.job_id,
    appId: value.app_id,
    releaseId: value.release_id,
    manifestChecksum: value.manifest_checksum,
    snapshotId: value.snapshot_id,
    status: value.status,
    blockedReason: value.blocked_reason,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    completedAt: value.completed_at,
    targets: value.targets.map((target) => ({
      targetId: target.target_id,
      installationId: target.installation_id,
      vaultId: target.vault_id,
      ordinal: target.ordinal,
      batch: target.batch,
      canary: target.canary,
      state: target.state,
      reason: target.reason,
      steps: target.steps.map((step) => ({
        stepId: step.step_id,
        operation: step.operation,
        state: step.state,
        checkpoint: step.checkpoint,
        reason: step.reason,
      })),
    })),
    replayed: value.replayed,
    sourceRolloutId: value.source_rollout_id,
    resumeOutcome: value.resume_outcome,
    resumeReason: value.resume_reason,
  };
}

function mapAuthorize(value: WireAuthorize): ControlPlaneAuthorize {
  return { authorized: value.authorized, correlationId: value.correlation_id };
}

function mapCredentialExchange(
  value: WireCredentialExchange,
): ControlPlaneCredentialExchange {
  return {
    accessToken: value.access_token,
    tokenType: value.token_type,
    expiresIn: value.expires_in,
    expiresAt: value.expires_at,
    correlationId: value.correlation_id,
  };
}
