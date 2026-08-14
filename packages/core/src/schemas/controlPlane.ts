import { z } from "zod";

const JsonPrimitiveSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/** JSON leaves that are intentionally opaque to Reef (for example manifests). */
export type ControlPlaneJsonValue =
  | string
  | number
  | boolean
  | null
  | ControlPlaneJsonValue[]
  | { [key: string]: ControlPlaneJsonValue };

export type ControlPlaneJsonObject = { [key: string]: ControlPlaneJsonValue };

export const ControlPlaneJsonValueSchema = z.lazy(() =>
  z.union([
    JsonPrimitiveSchema,
    z.array(ControlPlaneJsonValueSchema),
    z.record(z.string(), ControlPlaneJsonValueSchema),
  ]),
) as z.ZodType<ControlPlaneJsonValue>;

export const ControlPlaneJsonObjectSchema = z.record(
  z.string(),
  ControlPlaneJsonValueSchema,
);

export const ControlPlaneIdSchema = z.string().trim().min(1);
export const ControlPlaneDateTimeSchema = z.string().trim().min(1);

export const ControlPlaneInstallationLifecycleEnum = z.enum([
  "installing",
  "active",
  "upgrading",
  "blocked",
  "uninstalled",
]);

export const ControlPlaneCommandStatusEnum = z.enum([
  "accepted",
  "already_applied",
  "not_applicable",
]);

export const ControlPlaneDriftStatusEnum = z.enum([
  "in_sync",
  "mismatch",
  "unknown",
]);

export const ControlPlaneDriftOverallEnum = z.enum([
  "in_sync",
  "drifted",
  "unknown",
]);

export const ControlPlaneSnapshotTargetStateEnum = z.enum([
  "pending",
  "running",
  "denied",
  "skipped",
  "applied",
  "replayed",
]);

export const ControlPlaneRolloutStatusEnum = z.enum([
  "pending",
  "running",
  "applied",
  "blocked",
]);

export const ControlPlaneResumeOutcomeEnum = z.enum([
  "accepted",
  "replayed",
  "denied",
]);

export const ControlPlaneReleaseManifestSchema = z
  .object({
    steps: z.array(ControlPlaneJsonObjectSchema),
  })
  .catchall(ControlPlaneJsonValueSchema);

export const ControlPlaneReleaseReferenceSchema = z.object({
  id: ControlPlaneIdSchema.nullable().optional(),
  version: z.string().min(1).nullable().optional(),
});

export const ControlPlaneGrantSchema = z.object({
  generation: z.number().int().nonnegative(),
  status: z.enum(["active", "revoked"]),
  capabilities: z.array(z.string()),
});

export const ControlPlaneObservedSchema = z.object({
  generation: z.number().int().nonnegative(),
  observedAt: ControlPlaneDateTimeSchema.nullable().optional(),
  release: ControlPlaneReleaseReferenceSchema.nullable().optional(),
  schemaFingerprint: z.string().min(1).nullable().optional(),
  grantGeneration: z.number().int().nonnegative().nullable().optional(),
  checkpoint: ControlPlaneJsonObjectSchema,
  recentError: ControlPlaneJsonObjectSchema.nullable().optional(),
});

export const ControlPlaneOwnedResourceSchema = z.object({
  kind: z.string().min(1),
  key: z.string().min(1),
  status: z.enum(["owned", "retained"]),
});

export const ControlPlaneDriftDimensionSchema = z.object({
  status: ControlPlaneDriftStatusEnum,
  expected: ControlPlaneJsonValueSchema.nullable().optional(),
  actual: ControlPlaneJsonValueSchema.nullable().optional(),
});

export const ControlPlaneDriftSchema = z.object({
  release: ControlPlaneDriftDimensionSchema,
  schema: ControlPlaneDriftDimensionSchema,
  grant: ControlPlaneDriftDimensionSchema,
  overall: ControlPlaneDriftOverallEnum,
  reasons: z.array(z.string()),
  unknownDimensions: z.array(z.string()),
});

export const ControlPlaneInstallationSchema = z.object({
  installationId: ControlPlaneIdSchema,
  appId: ControlPlaneIdSchema,
  vaultId: ControlPlaneIdSchema,
  lifecycle: ControlPlaneInstallationLifecycleEnum,
  blockedReason: z.string().min(1).nullable().optional(),
  desiredRelease: ControlPlaneReleaseReferenceSchema.nullable().optional(),
  currentRelease: ControlPlaneReleaseReferenceSchema.nullable().optional(),
  observed: ControlPlaneObservedSchema.nullable().optional(),
  desiredGrantGeneration: z.number().int().nonnegative().optional(),
  latestGrant: ControlPlaneGrantSchema.nullable().optional(),
  activeGrant: ControlPlaneGrantSchema.nullable().optional(),
  ownedResources: z.array(ControlPlaneOwnedResourceSchema).optional(),
  checkpoint: ControlPlaneJsonObjectSchema.optional(),
  recentError: ControlPlaneJsonObjectSchema.nullable().optional(),
  drift: ControlPlaneDriftSchema.nullable().optional(),
  driftClassification: ControlPlaneDriftSchema.nullable().optional(),
  createdAt: ControlPlaneDateTimeSchema.nullable().optional(),
  updatedAt: ControlPlaneDateTimeSchema.nullable().optional(),
  commandStatus: ControlPlaneCommandStatusEnum.nullable().optional(),
  replayed: z.boolean().nullable().optional(),
});

export const ControlPlaneInventoryItemSchema = z.object({
  installationId: ControlPlaneIdSchema,
  appId: ControlPlaneIdSchema,
  vaultId: ControlPlaneIdSchema,
  vaultName: z.string().min(1),
  lifecycle: ControlPlaneInstallationLifecycleEnum,
  desiredRelease: ControlPlaneReleaseReferenceSchema.nullable().optional(),
  currentRelease: ControlPlaneReleaseReferenceSchema.nullable().optional(),
  observed: ControlPlaneObservedSchema.nullable().optional(),
  latestGrant: ControlPlaneGrantSchema.nullable().optional(),
  latestActiveGrant: ControlPlaneGrantSchema.nullable().optional(),
  grantGeneration: z.number().int().nonnegative(),
  checkpoint: ControlPlaneJsonObjectSchema,
  recentError: ControlPlaneJsonObjectSchema.nullable().optional(),
  drift: ControlPlaneDriftSchema,
  driftClassification: ControlPlaneDriftSchema,
  createdAt: ControlPlaneDateTimeSchema,
  updatedAt: ControlPlaneDateTimeSchema,
});

export const ControlPlaneInventorySchema = z.object({
  items: z.array(ControlPlaneInventoryItemSchema),
  nextCursor: z.string().min(1).nullable().optional(),
});

export const ControlPlaneSnapshotCreateSchema = z.object({
  snapshotId: ControlPlaneIdSchema,
  appId: ControlPlaneIdSchema.nullable().optional(),
  createdAt: ControlPlaneDateTimeSchema.nullable().optional(),
  sealedAt: ControlPlaneDateTimeSchema.nullable().optional(),
  requestedByKind: z.enum(["admin", "app"]).nullable().optional(),
  targetCount: z.number().int().nonnegative().optional(),
});

export const ControlPlaneSnapshotTargetSchema = z.object({
  targetId: ControlPlaneIdSchema,
  installationId: ControlPlaneIdSchema,
  vaultId: ControlPlaneIdSchema,
  desiredRelease: ControlPlaneReleaseReferenceSchema.nullable().optional(),
  currentRelease: ControlPlaneReleaseReferenceSchema.nullable().optional(),
  baselineGrantGeneration: z.number().int().nonnegative(),
  state: ControlPlaneSnapshotTargetStateEnum,
  reasonCode: z.string().min(1).nullable().optional(),
  createdAt: ControlPlaneDateTimeSchema,
  updatedAt: ControlPlaneDateTimeSchema,
});

export const ControlPlaneSnapshotSchema = z.object({
  snapshotId: ControlPlaneIdSchema,
  appId: ControlPlaneIdSchema,
  createdAt: ControlPlaneDateTimeSchema,
  sealedAt: ControlPlaneDateTimeSchema.nullable().optional(),
  requestedByKind: z.enum(["admin", "app"]),
  targetCount: z.number().int().nonnegative(),
  targets: z.array(ControlPlaneSnapshotTargetSchema),
});

export const ControlPlaneEligibilitySchema = z.object({
  targetId: ControlPlaneIdSchema,
  eligible: z.boolean(),
  executed: z.boolean(),
  state: z.string().min(1),
  reasonCode: z.string().min(1).nullable().optional(),
});

export const ControlPlaneRolloutStepSchema = z.object({
  stepId: z.string().min(1),
  operation: z.string().min(1),
  state: z.string().min(1),
  checkpoint: ControlPlaneJsonObjectSchema.optional(),
  reason: z.string().min(1).nullable().optional(),
});

export const ControlPlaneRolloutTargetSchema = z.object({
  targetId: ControlPlaneIdSchema,
  installationId: ControlPlaneIdSchema,
  vaultId: ControlPlaneIdSchema,
  ordinal: z.number().int().nonnegative(),
  batch: z.number().int().nonnegative(),
  canary: z.boolean(),
  state: z.string().min(1),
  reason: z.string().min(1).nullable().optional(),
  steps: z.array(ControlPlaneRolloutStepSchema),
});

export const ControlPlaneRolloutSchema = z.object({
  jobId: ControlPlaneIdSchema,
  appId: ControlPlaneIdSchema.nullable().optional(),
  releaseId: ControlPlaneIdSchema.nullable().optional(),
  manifestChecksum: z.string().min(1).nullable().optional(),
  snapshotId: ControlPlaneIdSchema.nullable().optional(),
  status: ControlPlaneRolloutStatusEnum.nullable().optional(),
  blockedReason: z.string().min(1).nullable().optional(),
  createdAt: ControlPlaneDateTimeSchema.nullable().optional(),
  updatedAt: ControlPlaneDateTimeSchema.nullable().optional(),
  completedAt: ControlPlaneDateTimeSchema.nullable().optional(),
  targets: z.array(ControlPlaneRolloutTargetSchema),
  replayed: z.boolean().nullable().optional(),
  sourceRolloutId: ControlPlaneIdSchema.nullable().optional(),
  resumeOutcome: ControlPlaneResumeOutcomeEnum.nullable().optional(),
  resumeReason: z.string().min(1).nullable().optional(),
});

export const ControlPlaneAppSchema = z.object({
  id: ControlPlaneIdSchema,
  appKey: z.string().min(1),
  displayName: z.string().min(1).nullable().optional(),
  description: z.string().min(1).nullable().optional(),
  metadata: ControlPlaneJsonObjectSchema,
  createdAt: ControlPlaneDateTimeSchema,
  updatedAt: ControlPlaneDateTimeSchema,
  replayed: z.boolean().nullable().optional(),
});

export const ControlPlaneReleaseSchema = z.object({
  id: ControlPlaneIdSchema,
  appId: ControlPlaneIdSchema,
  version: z.string().min(1),
  manifest: ControlPlaneReleaseManifestSchema,
  manifestChecksum: z.string().min(1),
  registeredAt: ControlPlaneDateTimeSchema,
  replayed: z.boolean().nullable().optional(),
});

export const ControlPlaneObservedStateResultSchema = z.object({
  accepted: z.boolean(),
  installationId: ControlPlaneIdSchema,
  observedGeneration: z.number().int().nonnegative(),
  observedAt: ControlPlaneDateTimeSchema,
});

export const ControlPlaneCredentialExchangeSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().positive(),
  expiresAt: ControlPlaneDateTimeSchema,
  correlationId: z.string().min(1),
});

export const ControlPlaneAuthorizeInputSchema = z.object({
  vaultId: ControlPlaneIdSchema,
  capability: z.string().trim().min(1),
  resourceKind: z.string().trim().min(1).nullable().optional(),
  resourceKey: z.string().trim().min(1).nullable().optional(),
});

export const ControlPlaneAuthorizeSchema = z.object({
  authorized: z.literal(true),
  correlationId: z.string().min(1),
});

export const ControlPlaneAppCreateInputSchema = z.object({
  appKey: z.string().trim().min(1),
  displayName: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().min(1).nullable().optional(),
  metadata: ControlPlaneJsonObjectSchema.optional(),
});

export const ControlPlaneAppUpdateInputSchema = z.object({
  displayName: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().min(1).nullable().optional(),
  metadata: ControlPlaneJsonObjectSchema.nullable().optional(),
});

export const ControlPlaneReleaseCreateInputSchema = z.object({
  version: z.string().trim().min(1),
  manifest: ControlPlaneReleaseManifestSchema,
  manifestChecksum: z.string().trim().min(1),
});

export const ControlPlaneInstallationCommandInputSchema = z.object({
  releaseId: ControlPlaneIdSchema,
  capabilities: z.array(z.string().trim().min(1)),
  mode: z.enum(["install", "restore", "fresh"]).optional(),
});

export const ControlPlaneObservedStateInputSchema = z.object({
  installationId: ControlPlaneIdSchema,
  observedGeneration: z.number().int().nonnegative(),
  observedAt: ControlPlaneDateTimeSchema.nullable().optional(),
  observedReleaseId: ControlPlaneIdSchema.nullable().optional(),
  observedReleaseVersion: z.string().min(1).nullable().optional(),
  schemaFingerprint: z.string().min(1).nullable().optional(),
  observedGrantGeneration: z.number().int().nonnegative().nullable().optional(),
  checkpoint: ControlPlaneJsonObjectSchema.optional(),
  recentError: ControlPlaneJsonObjectSchema.nullable().optional(),
});

export const ControlPlaneRolloutInputSchema = z.object({
  releaseId: ControlPlaneIdSchema,
  manifestChecksum: z.string().trim().min(1),
});

export const ControlPlaneListInventoryOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).nullable().optional(),
  lifecycle: ControlPlaneInstallationLifecycleEnum.nullable().optional(),
});

export const ControlPlaneCredentialExchangeInputSchema = z.object({
  credential: z.string().min(1),
});

export type ControlPlaneInstallationLifecycle = z.infer<
  typeof ControlPlaneInstallationLifecycleEnum
>;
export type ControlPlaneApp = z.infer<typeof ControlPlaneAppSchema>;
export type ControlPlaneRelease = z.infer<typeof ControlPlaneReleaseSchema>;
export type ControlPlaneInstallation = z.infer<
  typeof ControlPlaneInstallationSchema
>;
export type ControlPlaneInventoryItem = z.infer<
  typeof ControlPlaneInventoryItemSchema
>;
export type ControlPlaneInventory = z.infer<typeof ControlPlaneInventorySchema>;
export type ControlPlaneObservedState = z.infer<
  typeof ControlPlaneObservedSchema
>;
export type ControlPlaneObservedStateResult = z.infer<
  typeof ControlPlaneObservedStateResultSchema
>;
export type ControlPlaneSnapshotCreate = z.infer<
  typeof ControlPlaneSnapshotCreateSchema
>;
export type ControlPlaneSnapshot = z.infer<typeof ControlPlaneSnapshotSchema>;
export type ControlPlaneEligibility = z.infer<
  typeof ControlPlaneEligibilitySchema
>;
export type ControlPlaneRollout = z.infer<typeof ControlPlaneRolloutSchema>;
export type ControlPlaneCredentialExchange = z.infer<
  typeof ControlPlaneCredentialExchangeSchema
>;
export type ControlPlaneAuthorize = z.infer<typeof ControlPlaneAuthorizeSchema>;
export type ControlPlaneAppCreateInput = z.infer<
  typeof ControlPlaneAppCreateInputSchema
>;
export type ControlPlaneAppUpdateInput = z.infer<
  typeof ControlPlaneAppUpdateInputSchema
>;
export type ControlPlaneReleaseCreateInput = z.infer<
  typeof ControlPlaneReleaseCreateInputSchema
>;
export type ControlPlaneInstallationCommandInput = z.infer<
  typeof ControlPlaneInstallationCommandInputSchema
>;
export type ControlPlaneObservedStateInput = z.infer<
  typeof ControlPlaneObservedStateInputSchema
>;
export type ControlPlaneRolloutInput = z.infer<
  typeof ControlPlaneRolloutInputSchema
>;
export type ControlPlaneListInventoryOptions = z.infer<
  typeof ControlPlaneListInventoryOptionsSchema
>;
export type ControlPlaneCredentialExchangeInput = z.infer<
  typeof ControlPlaneCredentialExchangeInputSchema
>;
export type ControlPlaneAuthorizeInput = z.infer<
  typeof ControlPlaneAuthorizeInputSchema
>;
