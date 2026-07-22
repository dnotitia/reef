import { z } from "zod";
import { ConfigSchema } from "./config";

export const WorkspaceInitializationStateSchema = z.enum([
  "initializing",
  "writer_registered",
  "schema_provisioned",
  "skill_installed",
  "ready",
]);

export type WorkspaceInitializationState = z.infer<
  typeof WorkspaceInitializationStateSchema
>;

export const WORKSPACE_INITIALIZATION_STATES =
  WorkspaceInitializationStateSchema.options;

export const WorkspaceInitializationMarkerSchema = z
  .object({
    schema_version: z.number().int().positive(),
    state: WorkspaceInitializationStateSchema,
    request_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type WorkspaceInitializationMarker = z.infer<
  typeof WorkspaceInitializationMarkerSchema
>;

export const WorkspaceInitializationResultSchema = z.object({
  name: z.string().min(1),
  config: ConfigSchema,
  state: z.literal("ready"),
  marker_uri: z.string().min(1),
});

export type WorkspaceInitializationResult = z.infer<
  typeof WorkspaceInitializationResultSchema
>;
