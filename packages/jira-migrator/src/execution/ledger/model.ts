import { z } from "zod";
import { RawArchiveReferenceSchema } from "../../archive/model.js";
import {
  type JiraMigrationEntityKind,
  JiraMigrationEntityKindSchema,
  type JiraMigrationSourceIdentity,
  JiraMigrationSourceIdentitySchema,
  jiraCommentSourceIdentity,
  sourceKeyMatchesCanonicalOrLegacy,
} from "./identity.js";

export const JIRA_MIGRATION_PHASES = [
  "planning",
  "issues",
  "related",
  "reconciliation",
] as const;
export type JiraMigrationPhase = (typeof JIRA_MIGRATION_PHASES)[number];

export const JiraMigrationTargetSchema = z.discriminatedUnion("target_kind", [
  z.strictObject({
    target_kind: z.literal("release"),
    target_id: z.string().uuid(),
  }),
  z.strictObject({
    target_kind: z.literal("sprint"),
    target_id: z.string().uuid(),
  }),
  z.strictObject({
    target_kind: z.literal("issue"),
    reef_id: z.string().regex(/^[A-Z][A-Z0-9_-]*-\d+$/u),
    document_uri: z.string().startsWith("akb://"),
  }),
  z.strictObject({
    target_kind: z.literal("comment"),
    comment_id: z.string().uuid(),
  }),
  z.strictObject({
    target_kind: z.literal("attachment"),
    file_uri: z.string().startsWith("akb://"),
  }),
  z.strictObject({
    target_kind: z.literal("changelog_history"),
    idempotency_key: z.string().min(1),
  }),
  z.strictObject({
    target_kind: z.literal("relation"),
    idempotency_key: z.string().min(1),
  }),
]);
export type JiraMigrationTarget = z.infer<typeof JiraMigrationTargetSchema>;

export const targetAkbUri = (target: JiraMigrationTarget): string | null => {
  if (target.target_kind === "issue") return target.document_uri;
  if (target.target_kind === "attachment") return target.file_uri;
  return null;
};

export const akbUriBelongsToVault = (uri: string, vault: string): boolean => {
  try {
    const parsed = new URL(uri);
    return (
      parsed.protocol === "akb:" &&
      parsed.hostname === vault &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.port === ""
    );
  } catch {
    return false;
  }
};

export const expectedTargetKind: Record<
  JiraMigrationEntityKind,
  JiraMigrationTarget["target_kind"]
> = {
  version: "release",
  sprint: "sprint",
  issue: "issue",
  comment: "comment",
  attachment: "attachment",
  changelog_history: "changelog_history",
  relation: "relation",
};

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const isoSchema = z.string().datetime({ offset: true });

export const JiraMigrationBindingSchema = z.strictObject({
  source_key: z.string().min(1),
  entity_kind: JiraMigrationEntityKindSchema,
  source_identity: JiraMigrationSourceIdentitySchema,
  target: JiraMigrationTargetSchema,
  source_fingerprint: sha256Schema,
  mapped_state_fingerprint: sha256Schema,
  last_applied_at: isoSchema,
  raw_archive_reference: RawArchiveReferenceSchema.nullable(),
});
export type JiraMigrationBinding = z.infer<typeof JiraMigrationBindingSchema>;

export const JiraMigrationActionSchema = z.enum([
  "create",
  "update",
  "skip",
  "conflict",
  "retry",
  "failed",
]);
export type JiraMigrationAction = z.infer<typeof JiraMigrationActionSchema>;

export const JiraMigrationSafeErrorCodeSchema = z.enum([
  "target_unavailable",
  "target_write_failed",
  "target_readback_failed",
  "target_identity_conflict",
  "precondition_failed",
  "source_invalid",
  "operator_intervention_required",
]);

export const JiraMigrationEntityResultSchema = z
  .strictObject({
    source_key: z.string().min(1),
    entity_kind: JiraMigrationEntityKindSchema,
    source_fingerprint: sha256Schema,
    mapped_state_fingerprint: sha256Schema,
    action: JiraMigrationActionSchema,
    retryable: z.boolean(),
    error_code: JiraMigrationSafeErrorCodeSchema.nullable(),
    attempted_at: isoSchema,
    readback_at: isoSchema.nullable(),
    reconciliation_state: z.enum([
      "not_applicable",
      "pending_target_migration",
      "ready",
      "reconciled",
    ]),
  })
  .superRefine((result, context) => {
    if (!result.source_key.startsWith(`${result.entity_kind}:`)) {
      context.addIssue({
        code: "custom",
        message: "result source key kind mismatch",
        path: ["source_key"],
      });
    }
    if ((result.action === "failed") !== (result.error_code !== null)) {
      context.addIssue({
        code: "custom",
        message: "only failed results carry a safe error code",
        path: ["error_code"],
      });
    }
  });
export type JiraMigrationEntityResult = z.infer<
  typeof JiraMigrationEntityResultSchema
>;

const phaseStateSchema = z.strictObject({
  status: z.enum([
    "pending",
    "running",
    "completed",
    "partial_failed",
    "blocked",
  ]),
  entities: z.array(JiraMigrationEntityResultSchema),
});

export const JiraMigrationRunSchema = z.strictObject({
  run_id: z.string().min(1),
  project_keys: z.array(z.string().min(1)).min(1),
  started_at: isoSchema,
  updated_at: isoSchema,
  phase_order: z.tuple([
    z.literal("planning"),
    z.literal("issues"),
    z.literal("related"),
    z.literal("reconciliation"),
  ]),
  plan_fingerprint: sha256Schema,
  phases: z.strictObject({
    planning: phaseStateSchema,
    issues: phaseStateSchema,
    related: phaseStateSchema,
    reconciliation: phaseStateSchema,
  }),
});
export type JiraMigrationRun = z.infer<typeof JiraMigrationRunSchema>;

export const JiraCommentQuarantineSchema = z.strictObject({
  source_key: z.string().min(1),
  jira_cloud_id: z.string().min(1),
  issue_id: z.string().min(1),
  comment_id: z.string().min(1),
});

export const JiraMigrationLedgerV1Schema = z
  .strictObject({
    schema_version: z.literal(1),
    source_scope: z.strictObject({ jira_cloud_id: z.string().min(1) }),
    target_scope: z.strictObject({ vault: z.string().min(1) }),
    bindings: z.array(JiraMigrationBindingSchema),
    comment_quarantines: z.array(JiraCommentQuarantineSchema).default([]),
    runs: z.array(JiraMigrationRunSchema),
  })
  .superRefine((ledger, context) => {
    const bindingKeys = new Set<string>();
    for (const binding of ledger.bindings) {
      const akbUri = targetAkbUri(binding.target);
      if (
        binding.source_key !== binding.source_identity.key ||
        !sourceKeyMatchesCanonicalOrLegacy(
          binding.source_identity,
          binding.source_key,
        ) ||
        binding.entity_kind !== binding.source_identity.entity_kind ||
        binding.source_identity.jira_cloud_id !==
          ledger.source_scope.jira_cloud_id ||
        bindingKeys.has(binding.source_key)
      ) {
        context.addIssue({
          code: "custom",
          message: "binding identity is inconsistent or duplicated",
          path: ["bindings"],
        });
      }
      if (
        binding.target.target_kind !== expectedTargetKind[binding.entity_kind]
      ) {
        context.addIssue({
          code: "custom",
          message: "binding target kind does not match entity kind",
          path: ["bindings", binding.source_key, "target"],
        });
      }
      if (akbUri && !akbUriBelongsToVault(akbUri, ledger.target_scope.vault)) {
        context.addIssue({
          code: "custom",
          message: "binding target is outside the ledger vault scope",
          path: ["bindings", binding.source_key, "target"],
        });
      }
      bindingKeys.add(binding.source_key);
    }
    const quarantineKeys = new Set<string>();
    for (const quarantine of ledger.comment_quarantines) {
      const identity = jiraCommentSourceIdentity(
        quarantine.jira_cloud_id,
        quarantine.issue_id,
        quarantine.comment_id,
      );
      if (
        quarantine.source_key !== identity.key ||
        quarantine.jira_cloud_id !== ledger.source_scope.jira_cloud_id ||
        quarantineKeys.has(quarantine.source_key)
      ) {
        context.addIssue({
          code: "custom",
          message: "comment quarantine identity is inconsistent or duplicated",
          path: ["comment_quarantines"],
        });
      }
      quarantineKeys.add(quarantine.source_key);
    }
    if (
      new Set(ledger.runs.map((run) => run.run_id)).size !== ledger.runs.length
    ) {
      context.addIssue({
        code: "custom",
        message: "run_id must be unique",
        path: ["runs"],
      });
    }
    for (const run of ledger.runs) {
      if (
        JSON.stringify(run.project_keys) !==
        JSON.stringify([...new Set(run.project_keys)].sort())
      ) {
        context.addIssue({
          code: "custom",
          message: "project_keys must be unique and sorted",
          path: ["runs", run.run_id, "project_keys"],
        });
      }
      for (const phase of JIRA_MIGRATION_PHASES) {
        const keys = run.phases[phase].entities.map(
          (entity) => entity.source_key,
        );
        if (
          JSON.stringify(keys) !== JSON.stringify([...new Set(keys)].sort())
        ) {
          context.addIssue({
            code: "custom",
            message: "phase entity keys must be unique and sorted",
            path: ["runs", run.run_id, "phases", phase, "entities"],
          });
        }
      }
    }
  });
export type JiraMigrationLedgerV1 = z.infer<typeof JiraMigrationLedgerV1Schema>;

export class JiraMigrationLedgerError extends Error {
  constructor(
    readonly code:
      | "source_identity_scope_mismatch"
      | "target_scope_mismatch"
      | "target_readback_required"
      | "binding_target_conflict"
      | "run_plan_conflict"
      | "run_not_found",
  ) {
    super(code);
    this.name = "JiraMigrationLedgerError";
  }
}
