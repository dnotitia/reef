import { z } from "zod";

/** UUIDs and lifecycle values are part of the AKB app-installation wire contract. */
export const ControlPlaneIdSchema = z.string().uuid();
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

/** Public drift dimensions carry classification only, never expected/actual data. */
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
 * The only public projection exposed by the app-scoped installation reader.
 * Unknown AKB fields are stripped by this schema and are never reachable from
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
