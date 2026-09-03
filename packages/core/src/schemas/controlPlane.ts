import { z } from "zod";
import { AkbTableColumnTypeSchema } from "../adapters/akb/core/tableManifest";

/** UUIDs and lifecycle values are part of the AKB app-installation wire contract. */
export const ControlPlaneIdSchema = z.uuid();
export const ControlPlaneDateTimeSchema = z.string().min(1);

export const ControlPlaneInstallationLifecycleEnum = z.enum([
  "installing",
  "active",
  "upgrading",
  "blocked",
  "uninstalled",
]);

export const ControlPlaneReleaseReferenceSchema = z.object({
  id: ControlPlaneIdSchema.nullable().optional(),
  version: z.string().min(1).nullable().optional(),
});

export const ControlPlaneGrantSchema = z.object({
  generation: z.number().int().nonnegative(),
  status: z.enum(["active", "revoked"]),
  capabilities: z.array(z.string()),
});

/** Public observed state deliberately excludes AKB checkpoint/error blobs. */
export const ControlPlaneObservedSchema = z.object({
  generation: z.number().int().nonnegative(),
  observedAt: ControlPlaneDateTimeSchema.nullable().optional(),
  release: ControlPlaneReleaseReferenceSchema.nullable().optional(),
  schemaFingerprint: z.string().min(1).nullable().optional(),
  grantGeneration: z.number().int().nonnegative().nullable().optional(),
});

/** Public drift dimensions carry classification, without expected/actual data. */
export const ControlPlaneDriftDimensionSchema = z.object({
  status: z.enum(["in_sync", "mismatch", "unknown"]),
});

export const ControlPlaneDriftSchema = z.object({
  release: ControlPlaneDriftDimensionSchema,
  schema: ControlPlaneDriftDimensionSchema,
  grant: ControlPlaneDriftDimensionSchema,
  overall: z.enum(["in_sync", "drifted", "unknown"]),
  reasons: z.array(z.string()),
  unknownDimensions: z.array(z.string()),
});

/**
 * The public projection exposed by the app-scoped installation reader.
 * Unknown AKB fields are stripped by this schema and stay out of
 * the returned object.
 */
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
  drift: ControlPlaneDriftSchema.nullable().optional(),
  driftClassification: ControlPlaneDriftSchema.nullable().optional(),
});

export type ControlPlaneInstallationLifecycle = z.infer<
  typeof ControlPlaneInstallationLifecycleEnum
>;
export type ControlPlaneReleaseReference = z.infer<
  typeof ControlPlaneReleaseReferenceSchema
>;
export type ControlPlaneGrant = z.infer<typeof ControlPlaneGrantSchema>;
export type ControlPlaneObserved = z.infer<typeof ControlPlaneObservedSchema>;
export type ControlPlaneDriftDimension = z.infer<
  typeof ControlPlaneDriftDimensionSchema
>;
export type ControlPlaneDrift = z.infer<typeof ControlPlaneDriftSchema>;
export type ControlPlaneInstallation = z.infer<
  typeof ControlPlaneInstallationSchema
>;

/** Canonical values accepted by the Reef release artifact contract. */
export const ReleaseSha256Schema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]{64}$/u);

export const ReleaseVersionSchema = z
  .string()
  .min(5)
  .max(256)
  .regex(
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
  );

export const ReleaseSourceRevisionSchema = z
  .string()
  .min(40)
  .max(64)
  .regex(/^[0-9a-fA-F]{40,64}$/u);

export const ReleaseImageDigestSchema = z
  .string()
  .length(71)
  .regex(/^sha256:[0-9a-f]{64}$/u);

const ReleaseIdentifierSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z][a-z0-9_]*$/u);

/** A canonical table column; false optional flags are omitted. */
export const ReleaseManifestColumnSchema = z.strictObject({
  name: ReleaseIdentifierSchema,
  type: AkbTableColumnTypeSchema,
  required: z.boolean().optional(),
});

export const ReleaseManifestUniqueKeySchema = z.strictObject({
  columns: z.array(ReleaseIdentifierSchema).min(1).max(256),
});

export const ReleaseManifestIndexColumnSchema = z.strictObject({
  name: ReleaseIdentifierSchema,
  order: z.enum(["asc", "desc"]),
});

export const ReleaseManifestIndexSchema = z.strictObject({
  columns: z.array(ReleaseManifestIndexColumnSchema).min(1).max(256),
});

export const ReleaseManifestTableSchema = z.strictObject({
  name: ReleaseIdentifierSchema,
  columns: z.array(ReleaseManifestColumnSchema).max(256),
  unique_keys: z.array(ReleaseManifestUniqueKeySchema).max(256),
  indexes: z.array(ReleaseManifestIndexSchema).max(256),
});

export const ReleaseDesiredSchemaProjectionSchema = z.strictObject({
  tables: z.array(ReleaseManifestTableSchema).length(12),
  fingerprint: ReleaseSha256Schema,
});

export const ReleaseTransitionSourceSchema = z.strictObject({
  release_version: ReleaseVersionSchema,
  schema_fingerprint: ReleaseSha256Schema,
});

export const ReleaseTransitionPlanSourceSchema = z.union([
  z.literal("fresh"),
  ReleaseTransitionSourceSchema,
]);

const ReleaseStepIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u);

export const ReleaseCreateTablePayloadSchema = z.strictObject({
  table: ReleaseIdentifierSchema,
  columns: z.array(ReleaseManifestColumnSchema).max(256),
  unique_keys: z.array(ReleaseManifestUniqueKeySchema).max(256),
  indexes: z.array(ReleaseManifestIndexSchema).max(256),
});

export const ReleaseBlueprintStepSchema = z.strictObject({
  id: ReleaseStepIdSchema,
  phase: z.literal("expand"),
  operation: z.literal("create_table"),
  payload: ReleaseCreateTablePayloadSchema,
  checksum: ReleaseSha256Schema,
});

export const ReleaseManifestStepSchema = z.strictObject({
  id: ReleaseStepIdSchema,
  phase: z.literal("expand"),
  operation: z.literal("create_table"),
  payload: ReleaseCreateTablePayloadSchema,
  checksum: ReleaseSha256Schema,
});

export const ReleaseBlueprintTransitionPlanSchema = z.strictObject({
  source: ReleaseTransitionPlanSourceSchema,
  steps: z.array(ReleaseBlueprintStepSchema).max(256),
});

export const ReleaseManifestTransitionPlanSchema = z.strictObject({
  source: ReleaseTransitionPlanSourceSchema,
  steps: z.array(ReleaseManifestStepSchema).max(256),
});

/** App metadata is intentionally separate from immutable release data. */
export const ReefAppDefinitionSchema = z.strictObject({
  app_key: z.literal("reef"),
  display_name: z.string().min(1).nullable().optional(),
  description: z.string().min(1).nullable().optional(),
});

export const ReleaseBlueprintSchema = z.strictObject({
  app_definition: ReefAppDefinitionSchema,
  schema_version: z.literal(3),
  schema: ReleaseDesiredSchemaProjectionSchema,
  transition_plans: z.array(ReleaseBlueprintTransitionPlanSchema).length(1),
});

export const AppReleaseManifestSchema = z.strictObject({
  manifest_version: z.literal(2),
  app_key: z.literal("reef"),
  source_revision: ReleaseSourceRevisionSchema,
  image_digest: ReleaseImageDigestSchema,
  schema_version: z.literal(3),
  schema: ReleaseDesiredSchemaProjectionSchema,
  transition_plans: z.array(ReleaseManifestTransitionPlanSchema).length(1),
});

export const FinalizedReleasePayloadSchema = z.strictObject({
  version: ReleaseVersionSchema,
  manifest: AppReleaseManifestSchema,
  manifest_checksum: ReleaseSha256Schema,
});

export type ReleaseManifestColumn = z.infer<typeof ReleaseManifestColumnSchema>;
export type ReleaseManifestUniqueKey = z.infer<
  typeof ReleaseManifestUniqueKeySchema
>;
export type ReleaseManifestIndexColumn = z.infer<
  typeof ReleaseManifestIndexColumnSchema
>;
export type ReleaseManifestIndex = z.infer<typeof ReleaseManifestIndexSchema>;
export type ReleaseManifestTable = z.infer<typeof ReleaseManifestTableSchema>;
export type ReleaseDesiredSchemaProjection = z.infer<
  typeof ReleaseDesiredSchemaProjectionSchema
>;
export type ReleaseTransitionSource = z.infer<
  typeof ReleaseTransitionSourceSchema
>;
export type ReleaseTransitionPlanSource = z.infer<
  typeof ReleaseTransitionPlanSourceSchema
>;
export type ReleaseCreateTablePayload = z.infer<
  typeof ReleaseCreateTablePayloadSchema
>;
export type ReleaseBlueprintStep = z.infer<typeof ReleaseBlueprintStepSchema>;
export type ReleaseManifestStep = z.infer<typeof ReleaseManifestStepSchema>;
export type ReleaseBlueprintTransitionPlan = z.infer<
  typeof ReleaseBlueprintTransitionPlanSchema
>;
export type ReleaseManifestTransitionPlan = z.infer<
  typeof ReleaseManifestTransitionPlanSchema
>;
export type ReefAppDefinition = z.infer<typeof ReefAppDefinitionSchema>;
export type ReleaseBlueprint = z.infer<typeof ReleaseBlueprintSchema>;
export type AppReleaseManifest = z.infer<typeof AppReleaseManifestSchema>;
export type FinalizedReleasePayload = z.infer<
  typeof FinalizedReleasePayloadSchema
>;
