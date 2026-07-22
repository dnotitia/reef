import type { RawArchiveReference } from "../../archive/model.js";
import { deepFreeze } from "../../shared/objects.js";
import type {
  JiraMigrationSourceIdentity,
  jiraCommentSourceIdentity,
  jiraIssueSourceIdentity,
} from "./identity.js";
import {
  JIRA_MIGRATION_PHASES,
  JiraCommentQuarantineSchema,
  JiraMigrationBindingSchema,
  JiraMigrationLedgerError,
  type JiraMigrationLedgerV1,
  JiraMigrationLedgerV1Schema,
  type JiraMigrationRun,
  JiraMigrationRunSchema,
  type JiraMigrationTarget,
  JiraMigrationTargetSchema,
  akbUriBelongsToVault,
  expectedTargetKind,
  targetAkbUri,
} from "./model.js";

type JiraPlanningSourceIdentityInput =
  | {
      kind: "version";
      jiraCloudId: string;
      key: string;
      projectId: string;
      versionId: string;
    }
  | {
      kind: "sprint";
      jiraCloudId: string;
      key: string;
      sprintId: string;
    };

interface JiraPlanningLedgerBinding {
  sourceKey: string;
  targetKind: "release" | "sprint";
  targetId: string;
}

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
      comment_quarantines: [],
      runs: [],
    }),
  );

const sourceIdentityForPlanning = (
  identity: JiraPlanningSourceIdentityInput,
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
  sourceIdentity: JiraMigrationSourceIdentity | JiraPlanningSourceIdentityInput;
  target: JiraMigrationTarget;
  sourceFingerprint: string;
  mappedStateFingerprint: string;
  lastAppliedAt: string;
  writeSucceeded: boolean;
  readbackSucceeded: boolean;
  rawArchiveReference?: RawArchiveReference | null;
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

export const removeJiraMigrationBindings = (
  ledger: JiraMigrationLedgerV1,
  sourceKeys: readonly string[],
): JiraMigrationLedgerV1 => {
  const removed = new Set(sourceKeys);
  return deepFreeze(
    JiraMigrationLedgerV1Schema.parse({
      ...ledger,
      bindings: ledger.bindings.filter(
        (binding) => !removed.has(binding.source_key),
      ),
    }),
  );
};

export const quarantineJiraCommentSource = (
  ledger: JiraMigrationLedgerV1,
  identity: ReturnType<typeof jiraCommentSourceIdentity>,
): JiraMigrationLedgerV1 => {
  const quarantine = JiraCommentQuarantineSchema.parse({
    source_key: identity.key,
    jira_cloud_id: identity.jira_cloud_id,
    issue_id: identity.issue_id,
    comment_id: identity.comment_id,
  });
  const commentQuarantines = ledger.comment_quarantines
    .filter((item) => item.source_key !== identity.key)
    .concat(quarantine)
    .sort((left, right) => left.source_key.localeCompare(right.source_key));
  return deepFreeze(
    JiraMigrationLedgerV1Schema.parse({
      ...ledger,
      comment_quarantines: commentQuarantines,
    }),
  );
};

export const clearJiraCommentQuarantine = (
  ledger: JiraMigrationLedgerV1,
  sourceKeys: readonly string[],
): JiraMigrationLedgerV1 => {
  const cleared = new Set(sourceKeys);
  return deepFreeze(
    JiraMigrationLedgerV1Schema.parse({
      ...ledger,
      comment_quarantines: ledger.comment_quarantines.filter(
        (item) => !cleared.has(item.source_key),
      ),
    }),
  );
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
