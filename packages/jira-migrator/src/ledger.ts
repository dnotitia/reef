import { z } from "zod";
import { deepFreeze } from "./customFields.js";
import { RawArchiveReferenceSchema } from "./importPlan.js";
import type { JiraPlanningLedgerBinding } from "./planning.js";

export const JIRA_MIGRATION_PHASES = [
  "planning",
  "issues",
  "related",
  "reconciliation",
] as const;
export type JiraMigrationPhase = (typeof JIRA_MIGRATION_PHASES)[number];

export const JiraMigrationEntityKindSchema = z.enum([
  "version",
  "sprint",
  "issue",
  "comment",
  "attachment",
  "changelog_history",
  "relation",
]);
export type JiraMigrationEntityKind = z.infer<
  typeof JiraMigrationEntityKindSchema
>;

const sourceIdentityBase = {
  jira_cloud_id: z.string().min(1),
  key: z.string().min(1),
};

export const JiraMigrationSourceIdentitySchema = z.discriminatedUnion(
  "entity_kind",
  [
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("version"),
        project_id: z.string().min(1),
        version_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("sprint"),
        sprint_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("issue"),
        project_id: z.string().min(1),
        issue_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("comment"),
        issue_id: z.string().min(1),
        comment_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("attachment"),
        attachment_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("changelog_history"),
        issue_id: z.string().min(1),
        history_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("relation"),
        source_issue_id: z.string().min(1),
        target_issue_id: z.string().min(1),
        link_type: z.string().min(1),
        direction: z.string().min(1),
        link_id: z.string().min(1),
      })
      .strict(),
  ],
);
export type JiraMigrationSourceIdentity = z.infer<
  typeof JiraMigrationSourceIdentitySchema
>;

const encodedKey = (kind: string, parts: readonly string[]): string =>
  `${kind}:${parts.map((value) => encodeURIComponent(value)).join(":")}`;

const canonicalSourceKey = (identity: JiraMigrationSourceIdentity): string => {
  switch (identity.entity_kind) {
    case "version":
      return encodedKey("version", [
        identity.jira_cloud_id,
        identity.project_id,
        identity.version_id,
      ]);
    case "sprint":
      return encodedKey("sprint", [identity.jira_cloud_id, identity.sprint_id]);
    case "issue":
      return encodedKey("issue", [
        identity.jira_cloud_id,
        identity.project_id,
        identity.issue_id,
      ]);
    case "comment":
      return encodedKey("comment", [
        identity.jira_cloud_id,
        identity.issue_id,
        identity.comment_id,
      ]);
    case "attachment":
      return encodedKey("attachment", [
        identity.jira_cloud_id,
        identity.attachment_id,
      ]);
    case "changelog_history":
      return encodedKey("changelog_history", [
        identity.jira_cloud_id,
        identity.issue_id,
        identity.history_id,
      ]);
    case "relation":
      return encodedKey("relation", [identity.jira_cloud_id, identity.link_id]);
  }
};

const sourceKeyMatchesCanonicalOrLegacy = (
  identity: JiraMigrationSourceIdentity,
  sourceKey: string,
): boolean =>
  sourceKey === canonicalSourceKey(identity) ||
  (identity.entity_kind === "relation" &&
    sourceKey ===
      legacyJiraRelationSourceKey(
        identity.jira_cloud_id,
        identity.source_issue_id,
        identity.target_issue_id,
        identity.link_type,
        identity.direction,
        identity.link_id,
      ));

export const JiraMigrationTargetSchema = z.discriminatedUnion("target_kind", [
  z
    .object({ target_kind: z.literal("release"), target_id: z.string().uuid() })
    .strict(),
  z
    .object({ target_kind: z.literal("sprint"), target_id: z.string().uuid() })
    .strict(),
  z
    .object({
      target_kind: z.literal("issue"),
      reef_id: z.string().regex(/^[A-Z][A-Z0-9_-]*-\d+$/u),
      document_uri: z.string().startsWith("akb://"),
    })
    .strict(),
  z
    .object({
      target_kind: z.literal("comment"),
      comment_id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      target_kind: z.literal("attachment"),
      file_uri: z.string().startsWith("akb://"),
    })
    .strict(),
  z
    .object({
      target_kind: z.literal("changelog_history"),
      idempotency_key: z.string().min(1),
    })
    .strict(),
  z
    .object({
      target_kind: z.literal("relation"),
      idempotency_key: z.string().min(1),
    })
    .strict(),
]);
export type JiraMigrationTarget = z.infer<typeof JiraMigrationTargetSchema>;

const targetAkbUri = (target: JiraMigrationTarget): string | null => {
  if (target.target_kind === "issue") return target.document_uri;
  if (target.target_kind === "attachment") return target.file_uri;
  return null;
};

const akbUriBelongsToVault = (uri: string, vault: string): boolean => {
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

const expectedTargetKind: Record<
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

export const JiraMigrationBindingSchema = z
  .object({
    source_key: z.string().min(1),
    entity_kind: JiraMigrationEntityKindSchema,
    source_identity: JiraMigrationSourceIdentitySchema,
    target: JiraMigrationTargetSchema,
    source_fingerprint: sha256Schema,
    mapped_state_fingerprint: sha256Schema,
    last_applied_at: isoSchema,
    raw_archive_reference: RawArchiveReferenceSchema.nullable(),
  })
  .strict();
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
  .object({
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
  .strict()
  .superRefine((result, context) => {
    if (!result.source_key.startsWith(`${result.entity_kind}:`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "result source key kind mismatch",
        path: ["source_key"],
      });
    }
    if ((result.action === "failed") !== (result.error_code !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only failed results carry a safe error code",
        path: ["error_code"],
      });
    }
  });
export type JiraMigrationEntityResult = z.infer<
  typeof JiraMigrationEntityResultSchema
>;

const phaseStateSchema = z
  .object({
    status: z.enum([
      "pending",
      "running",
      "completed",
      "partial_failed",
      "blocked",
    ]),
    entities: z.array(JiraMigrationEntityResultSchema),
  })
  .strict();

export const JiraMigrationRunSchema = z
  .object({
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
    phases: z
      .object({
        planning: phaseStateSchema,
        issues: phaseStateSchema,
        related: phaseStateSchema,
        reconciliation: phaseStateSchema,
      })
      .strict(),
  })
  .strict();
export type JiraMigrationRun = z.infer<typeof JiraMigrationRunSchema>;

export const JiraMigrationLedgerV1Schema = z
  .object({
    schema_version: z.literal(1),
    source_scope: z.object({ jira_cloud_id: z.string().min(1) }).strict(),
    target_scope: z.object({ vault: z.string().min(1) }).strict(),
    bindings: z.array(JiraMigrationBindingSchema),
    runs: z.array(JiraMigrationRunSchema),
  })
  .strict()
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
          code: z.ZodIssueCode.custom,
          message: "binding identity is inconsistent or duplicated",
          path: ["bindings"],
        });
      }
      if (
        binding.target.target_kind !== expectedTargetKind[binding.entity_kind]
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "binding target kind does not match entity kind",
          path: ["bindings", binding.source_key, "target"],
        });
      }
      if (akbUri && !akbUriBelongsToVault(akbUri, ledger.target_scope.vault)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "binding target is outside the ledger vault scope",
          path: ["bindings", binding.source_key, "target"],
        });
      }
      bindingKeys.add(binding.source_key);
    }
    if (
      new Set(ledger.runs.map((run) => run.run_id)).size !== ledger.runs.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
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
          code: z.ZodIssueCode.custom,
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
            code: z.ZodIssueCode.custom,
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

export const jiraIssueSourceIdentity = (
  jiraCloudId: string,
  projectId: string,
  issueId: string,
) => ({
  entity_kind: "issue" as const,
  jira_cloud_id: jiraCloudId,
  project_id: projectId,
  issue_id: issueId,
  key: encodedKey("issue", [jiraCloudId, projectId, issueId]),
});

export const jiraCommentSourceIdentity = (
  jiraCloudId: string,
  issueId: string,
  commentId: string,
) => ({
  entity_kind: "comment" as const,
  jira_cloud_id: jiraCloudId,
  issue_id: issueId,
  comment_id: commentId,
  key: encodedKey("comment", [jiraCloudId, issueId, commentId]),
});

export const jiraAttachmentSourceIdentity = (
  jiraCloudId: string,
  attachmentId: string,
) => ({
  entity_kind: "attachment" as const,
  jira_cloud_id: jiraCloudId,
  attachment_id: attachmentId,
  key: encodedKey("attachment", [jiraCloudId, attachmentId]),
});

export const jiraChangelogSourceIdentity = (
  jiraCloudId: string,
  issueId: string,
  historyId: string,
) => ({
  entity_kind: "changelog_history" as const,
  jira_cloud_id: jiraCloudId,
  issue_id: issueId,
  history_id: historyId,
  key: encodedKey("changelog_history", [jiraCloudId, issueId, historyId]),
});

export const jiraRelationSourceIdentity = (
  jiraCloudId: string,
  sourceIssueId: string,
  targetIssueId: string,
  linkType: string,
  direction: string,
  linkId: string,
) => ({
  entity_kind: "relation" as const,
  jira_cloud_id: jiraCloudId,
  source_issue_id: sourceIssueId,
  target_issue_id: targetIssueId,
  link_type: linkType,
  direction,
  link_id: linkId,
  key: encodedKey("relation", [jiraCloudId, linkId]),
});

export const legacyJiraRelationSourceKey = (
  jiraCloudId: string,
  sourceIssueId: string,
  targetIssueId: string,
  linkType: string,
  direction: string,
  linkId: string,
): string =>
  encodedKey("relation", [
    jiraCloudId,
    sourceIssueId,
    targetIssueId,
    linkType,
    direction,
    linkId,
  ]);

const emptyPhases = (): JiraMigrationRun["phases"] => ({
  planning: { status: "pending", entities: [] },
  issues: { status: "pending", entities: [] },
  related: { status: "pending", entities: [] },
  reconciliation: { status: "pending", entities: [] },
});

export const createJiraMigrationLedger = ({
  jiraCloudId,
  targetVault,
}: {
  jiraCloudId: string;
  targetVault: string;
}): JiraMigrationLedgerV1 =>
  deepFreeze(
    JiraMigrationLedgerV1Schema.parse({
      schema_version: 1,
      source_scope: { jira_cloud_id: jiraCloudId },
      target_scope: { vault: targetVault },
      bindings: [],
      runs: [],
    }),
  );

const sourceIdentityForPlanning = (
  identity:
    | ReturnType<typeof import("./planning.js").jiraVersionSourceIdentity>
    | ReturnType<typeof import("./planning.js").jiraSprintSourceIdentity>,
): JiraMigrationSourceIdentity =>
  identity.kind === "version"
    ? {
        entity_kind: "version",
        jira_cloud_id: identity.jiraCloudId,
        project_id: identity.projectId,
        version_id: identity.versionId,
        key: identity.key,
      }
    : {
        entity_kind: "sprint",
        jira_cloud_id: identity.jiraCloudId,
        sprint_id: identity.sprintId,
        key: identity.key,
      };

export interface ConfirmJiraMigrationBindingInput {
  sourceIdentity:
    | JiraMigrationSourceIdentity
    | ReturnType<typeof import("./planning.js").jiraVersionSourceIdentity>
    | ReturnType<typeof import("./planning.js").jiraSprintSourceIdentity>;
  target: JiraMigrationTarget;
  sourceFingerprint: string;
  mappedStateFingerprint: string;
  lastAppliedAt: string;
  writeSucceeded: boolean;
  readbackSucceeded: boolean;
  rawArchiveReference?: z.infer<typeof RawArchiveReferenceSchema> | null;
}

export const confirmJiraMigrationBinding = (
  ledger: JiraMigrationLedgerV1,
  input: ConfirmJiraMigrationBindingInput,
): JiraMigrationLedgerV1 => {
  if (!input.writeSucceeded || !input.readbackSucceeded) {
    throw new JiraMigrationLedgerError("target_readback_required");
  }
  const identity =
    "entity_kind" in input.sourceIdentity
      ? input.sourceIdentity
      : sourceIdentityForPlanning(input.sourceIdentity);
  if (identity.jira_cloud_id !== ledger.source_scope.jira_cloud_id) {
    throw new JiraMigrationLedgerError("source_identity_scope_mismatch");
  }
  if (input.target.target_kind !== expectedTargetKind[identity.entity_kind]) {
    throw new JiraMigrationLedgerError("binding_target_conflict");
  }
  const target = JiraMigrationTargetSchema.parse(input.target);
  const akbUri = targetAkbUri(target);
  if (akbUri && !akbUriBelongsToVault(akbUri, ledger.target_scope.vault)) {
    throw new JiraMigrationLedgerError("target_scope_mismatch");
  }
  const existing = ledger.bindings.find(
    (item) => item.source_key === identity.key,
  );
  if (existing && JSON.stringify(existing.target) !== JSON.stringify(target)) {
    throw new JiraMigrationLedgerError("binding_target_conflict");
  }
  const binding = JiraMigrationBindingSchema.parse({
    source_key: identity.key,
    entity_kind: identity.entity_kind,
    source_identity: identity,
    target,
    source_fingerprint: input.sourceFingerprint,
    mapped_state_fingerprint: input.mappedStateFingerprint,
    last_applied_at: input.lastAppliedAt,
    raw_archive_reference: input.rawArchiveReference ?? null,
  });
  const bindings = ledger.bindings
    .filter((item) => item.source_key !== identity.key)
    .concat(binding)
    .sort((left, right) => left.source_key.localeCompare(right.source_key));
  return deepFreeze(JiraMigrationLedgerV1Schema.parse({ ...ledger, bindings }));
};

export const getJiraPlanningLedgerBindings = (
  ledger: JiraMigrationLedgerV1,
): JiraPlanningLedgerBinding[] =>
  ledger.bindings
    .flatMap((binding): JiraPlanningLedgerBinding[] => {
      if (binding.target.target_kind === "release") {
        return [
          {
            sourceKey: binding.source_key,
            targetKind: "release",
            targetId: binding.target.target_id,
          },
        ];
      }
      if (binding.target.target_kind === "sprint") {
        return [
          {
            sourceKey: binding.source_key,
            targetKind: "sprint",
            targetId: binding.target.target_id,
          },
        ];
      }
      return [];
    })
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));

export const getJiraIssueTarget = (
  ledger: JiraMigrationLedgerV1,
  identity: ReturnType<typeof jiraIssueSourceIdentity>,
) => {
  const target = ledger.bindings.find(
    (binding) => binding.source_key === identity.key,
  )?.target;
  return target?.target_kind === "issue" ? target : null;
};

export const getJiraCommentTargetId = (
  ledger: JiraMigrationLedgerV1,
  identity: ReturnType<typeof jiraCommentSourceIdentity>,
): string | null => {
  const target = ledger.bindings.find(
    (binding) => binding.source_key === identity.key,
  )?.target;
  return target?.target_kind === "comment" ? target.comment_id : null;
};

export const openJiraMigrationRun = (
  ledger: JiraMigrationLedgerV1,
  input: {
    runId: string;
    projectKeys: readonly string[];
    planFingerprint: string;
    at: string;
  },
): JiraMigrationLedgerV1 => {
  const projectKeys = [...new Set(input.projectKeys)].sort();
  const existing = ledger.runs.find((run) => run.run_id === input.runId);
  if (existing) {
    if (
      existing.plan_fingerprint !== input.planFingerprint ||
      JSON.stringify(existing.project_keys) !== JSON.stringify(projectKeys)
    ) {
      throw new JiraMigrationLedgerError("run_plan_conflict");
    }
    return ledger;
  }
  const run = JiraMigrationRunSchema.parse({
    run_id: input.runId,
    project_keys: projectKeys,
    started_at: input.at,
    updated_at: input.at,
    phase_order: JIRA_MIGRATION_PHASES,
    plan_fingerprint: input.planFingerprint,
    phases: emptyPhases(),
  });
  return deepFreeze(
    JiraMigrationLedgerV1Schema.parse({
      ...ledger,
      runs: [...ledger.runs, run],
    }),
  );
};
