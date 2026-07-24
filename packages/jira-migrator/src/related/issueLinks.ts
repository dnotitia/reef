import { fingerprintJiraState } from "../execution/diff.js";
import {
  type JiraMigrationLedgerV1,
  confirmJiraMigrationBinding,
  jiraRelationSourceIdentity,
  legacyJiraRelationSourceKey,
  removeJiraMigrationBindings,
} from "../ledger.js";
import type { NormalizedJiraIssueLink } from "../payloads.js";
import type {
  JiraRelatedImportInput,
  JiraRelatedImportReport,
} from "./contracts.js";
import {
  canonicalizeJiraRelation,
  reconcileProvisionalLinkRefs,
  sameLinkMapping,
} from "./links.js";
import { recordRelatedOperation } from "./operations.js";
import { failure } from "./reporting.js";

export async function importIssueLinks(options: {
  migration: JiraRelatedImportInput;
  issueId: string;
  issueKey: string;
  projectKey: string;
  linkCatalogPresent: boolean;
  links: readonly NormalizedJiraIssueLink[];
  ledger: JiraMigrationLedgerV1;
  report: JiraRelatedImportReport;
  now: () => string;
}): Promise<JiraMigrationLedgerV1> {
  const {
    migration,
    issueId,
    issueKey,
    projectKey,
    linkCatalogPresent,
    links,
    report,
    now,
  } = options;
  let ledger = options.ledger;
  const removeStaleRelationBindings = async (linkId: string): Promise<void> => {
    const staleRelationBindings = ledger.bindings.filter(
      (binding) =>
        binding.source_identity.entity_kind === "relation" &&
        binding.source_identity.jira_cloud_id === migration.jiraCloudId &&
        binding.source_identity.link_id === linkId,
    );
    const staleRelationKeys = new Set(
      staleRelationBindings.flatMap((binding) =>
        binding.target.target_kind === "relation"
          ? [binding.target.idempotency_key]
          : [],
      ),
    );
    for (const relationKey of staleRelationKeys) {
      await migration.target.deleteRelation(relationKey);
      if (
        migration.mode === "apply" &&
        (await migration.target.readRelation(relationKey)) !== null
      )
        throw new Error("relation_mapping_removal_readback_mismatch");
    }
    if (migration.mode === "apply") {
      ledger = removeJiraMigrationBindings(
        ledger,
        staleRelationBindings.map((binding) => binding.source_key),
      );
    }
  };
  const uniqueLinks = new Map<string, NormalizedJiraIssueLink>();
  const conflictingLinkIds = new Set<string>();
  for (const link of links) {
    if (!link.id) {
      failure(
        report.failures,
        "link",
        "missing",
        "resolve",
        "jira_link_id_missing",
      );
      continue;
    }
    if (conflictingLinkIds.has(link.id)) continue;
    const existing = uniqueLinks.get(link.id);
    if (
      existing &&
      fingerprintJiraState(existing) !== fingerprintJiraState(link)
    ) {
      uniqueLinks.delete(link.id);
      conflictingLinkIds.add(link.id);
      failure(
        report.failures,
        "link",
        link.id,
        "resolve",
        "jira_link_duplicate_conflict",
      );
      continue;
    }
    uniqueLinks.set(link.id, link);
  }
  report.links.unique = uniqueLinks.size;
  for (const linkId of conflictingLinkIds) {
    try {
      await removeStaleRelationBindings(linkId);
      await reconcileProvisionalLinkRefs(
        migration.target,
        migration.jiraCloudId,
        linkId,
        migration.mode,
      );
    } catch (error) {
      failure(
        report.failures,
        "link",
        linkId,
        String(error).includes("readback") ? "readback" : "write",
        "link_source_reconciliation_failed",
        error,
      );
    }
  }
  if (linkCatalogPresent) {
    const provisionalPrefix = `jira-link:${migration.jiraCloudId}:${issueId}:`;
    const currentProvisionalKeys = new Set(
      [...uniqueLinks.keys()].map((linkId) => `${provisionalPrefix}${linkId}`),
    );
    let existingProvisionalKeys: string[] = [];
    try {
      existingProvisionalKeys =
        await migration.target.listExternalRefKeys(provisionalPrefix);
    } catch (error) {
      failure(
        report.failures,
        "link",
        issueId,
        "read",
        "link_target_catalog_read_failed",
        error,
      );
    }
    for (const existingKey of existingProvisionalKeys) {
      if (currentProvisionalKeys.has(existingKey)) continue;
      try {
        const existing = await migration.target.readExternalRef(existingKey);
        if (
          existing &&
          (existing.provenance.source !== "jira" ||
            existing.provenance.unresolved !== true)
        )
          throw new Error("external_ref_reconciliation_mismatch");
        if (existing) await migration.target.deleteExternalRef(existingKey);
        if (
          migration.mode === "apply" &&
          (await migration.target.readExternalRef(existingKey)) !== null
        )
          throw new Error("external_ref_delete_readback_mismatch");
      } catch (error) {
        failure(
          report.failures,
          "link",
          `sha256:${fingerprintJiraState(existingKey)}`,
          String(error).includes("readback") ? "readback" : "write",
          "link_source_reconciliation_failed",
          error,
        );
      }
    }
    const missingRelationBindings = ledger.bindings.filter(
      (binding) =>
        binding.source_identity.entity_kind === "relation" &&
        binding.source_identity.jira_cloud_id === migration.jiraCloudId &&
        (binding.source_identity.source_issue_id === issueId ||
          binding.source_identity.source_issue_id === issueKey) &&
        !uniqueLinks.has(binding.source_identity.link_id),
    );
    for (const binding of missingRelationBindings) {
      if (binding.source_identity.entity_kind !== "relation") continue;
      const linkId = binding.source_identity.link_id;
      try {
        await removeStaleRelationBindings(linkId);
        await reconcileProvisionalLinkRefs(
          migration.target,
          migration.jiraCloudId,
          linkId,
          migration.mode,
        );
      } catch (error) {
        failure(
          report.failures,
          "link",
          linkId,
          String(error).includes("readback") ? "readback" : "write",
          "link_source_reconciliation_failed",
          error,
        );
      }
    }
  }
  for (const [linkId, link] of uniqueLinks) {
    try {
      const mappingMatches = migration.linkMappings.filter((item) =>
        sameLinkMapping(item, link),
      );
      const mapping =
        mappingMatches.length === 1 ? mappingMatches[0] : undefined;
      if (mappingMatches.length > 1) {
        report.links.unresolved += 1;
        await removeStaleRelationBindings(linkId);
        failure(
          report.failures,
          "link",
          linkId,
          "resolve",
          "jira_link_mapping_ambiguous",
        );
        continue;
      }
      const targetIssue = migration.resolveIssueTarget(
        link.issueId ?? link.issueKey,
      );
      const linkedSource = link.issueId ?? link.issueKey;
      if (
        !targetIssue &&
        migration.preserveUnresolvedIssueTargets?.has(linkedSource)
      ) {
        failure(
          report.failures,
          "link",
          linkId,
          "resolve",
          "linked_issue_not_confirmed",
        );
        continue;
      }
      if (!mapping || !targetIssue) {
        report.links.unresolved += 1;
        await removeStaleRelationBindings(linkId);
        const externalKey = `jira-link:${migration.jiraCloudId}:${issueId}:${linkId}`;
        const externalValue = {
          reefId: migration.reefId,
          ref: {
            type: "jira" as const,
            ref: link.issueKey,
            label: "Jira issue link",
          },
          provenance: {
            source: "jira",
            link_id: linkId,
            type: {
              id: link.typeId,
              name: link.type,
              inward: link.inward,
              outward: link.outward,
            },
            unresolved: true,
          },
        };
        const existing = await migration.target.readExternalRef(externalKey);
        if (
          existing &&
          fingerprintJiraState(existing) === fingerprintJiraState(externalValue)
        ) {
          report.links.skipped += 1;
          continue;
        }
        if (migration.mode === "dry-run") {
          recordRelatedOperation(report, "put_external_ref", externalKey, {
            idempotencyKey: externalKey,
            ...externalValue,
          });
        } else {
          await migration.target.putExternalRef({
            idempotencyKey: externalKey,
            ...externalValue,
          });
          const readback = await migration.target.readExternalRef(externalKey);
          if (
            fingerprintJiraState(readback) !==
            fingerprintJiraState(externalValue)
          )
            throw new Error("external_ref_readback_missing");
        }
        continue;
      }
      const { relation, inverseRelation, sourceReefId, targetReefId } =
        canonicalizeJiraRelation(
          mapping,
          link.direction,
          migration.reefId,
          targetIssue.reefId,
        );
      const targetIssueId = link.issueId ?? link.issueKey;
      const linkType = link.typeId ?? link.type ?? "unknown";
      const identity = jiraRelationSourceIdentity(
        migration.jiraCloudId,
        issueId,
        targetIssueId,
        linkType,
        link.direction,
        linkId,
        projectKey,
      );
      const legacyKey = legacyJiraRelationSourceKey(
        migration.jiraCloudId,
        issueId,
        targetIssueId,
        linkType,
        link.direction,
        linkId,
      );
      const mappedStateFingerprint = fingerprintJiraState({
        source: sourceReefId,
        target: targetReefId,
        relation,
        inverseRelation,
      });
      const expectedRelation = {
        sourceReefId,
        targetReefId,
        relation,
        inverseRelation,
      };
      const semanticBindings = ledger.bindings.filter(
        (item) =>
          item.source_key === identity.key ||
          item.source_key === legacyKey ||
          (item.source_identity.entity_kind === "relation" &&
            item.source_identity.jira_cloud_id === migration.jiraCloudId &&
            item.source_identity.link_id === linkId),
      );
      const existingBinding = semanticBindings.find(
        (binding) => binding.source_key === identity.key,
      );
      if (
        semanticBindings.length === 1 &&
        existingBinding?.target.target_kind === "relation"
      ) {
        const existingRelation = await migration.target.readRelation(
          existingBinding.target.idempotency_key,
        );
        if (
          existingBinding.mapped_state_fingerprint === mappedStateFingerprint &&
          fingerprintJiraState(existingRelation) ===
            fingerprintJiraState(expectedRelation)
        ) {
          await reconcileProvisionalLinkRefs(
            migration.target,
            migration.jiraCloudId,
            linkId,
            migration.mode,
          );
          report.links.skipped += 1;
          continue;
        }
      }
      const relationKey = identity.key;
      const relationInput = {
        idempotencyKey: relationKey,
        ...expectedRelation,
        provenance: { source: "jira", link_id: linkId },
      };
      if (migration.mode === "dry-run") {
        recordRelatedOperation(
          report,
          "put_relation",
          relationKey,
          relationInput,
        );
        await reconcileProvisionalLinkRefs(
          migration.target,
          migration.jiraCloudId,
          linkId,
          "dry-run",
        );
        for (const legacyBinding of semanticBindings) {
          if (
            legacyBinding.target.target_kind !== "relation" ||
            legacyBinding.target.idempotency_key === relationKey
          )
            continue;
          await migration.target.deleteRelation(
            legacyBinding.target.idempotency_key,
          );
        }
        continue;
      }
      await migration.target.putRelation(relationInput);
      const relationReadback = await migration.target.readRelation(relationKey);
      if (
        fingerprintJiraState(relationReadback) !==
        fingerprintJiraState(expectedRelation)
      )
        throw new Error("relation_readback_missing");
      await reconcileProvisionalLinkRefs(
        migration.target,
        migration.jiraCloudId,
        linkId,
      );
      for (const legacyBinding of semanticBindings) {
        if (
          legacyBinding.target.target_kind !== "relation" ||
          legacyBinding.target.idempotency_key === relationKey
        )
          continue;
        await migration.target.deleteRelation(
          legacyBinding.target.idempotency_key,
        );
        if (
          (await migration.target.readRelation(
            legacyBinding.target.idempotency_key,
          )) !== null
        )
          throw new Error("relation_legacy_delete_readback_mismatch");
      }
      ledger = removeJiraMigrationBindings(
        ledger,
        semanticBindings.map((binding) => binding.source_key),
      );
      ledger = confirmJiraMigrationBinding(ledger, {
        sourceIdentity: identity,
        target: { target_kind: "relation", idempotency_key: relationKey },
        sourceFingerprint: fingerprintJiraState(link),
        mappedStateFingerprint,
        lastAppliedAt: now(),
        writeSucceeded: true,
        readbackSucceeded: true,
      });
      report.links.applied += 1;
    } catch (error) {
      failure(
        report.failures,
        "link",
        linkId,
        String(error).includes("readback") ? "readback" : "write",
        "link_import_failed",
        error,
      );
    }
  }

  return ledger;
}
