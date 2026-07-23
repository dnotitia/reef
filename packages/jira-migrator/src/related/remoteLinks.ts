import { fingerprintJiraState } from "../execution/diff.js";
import type { JiraRemoteLinkPayload } from "../payloads.js";
import type {
  JiraRelatedImportInput,
  JiraRelatedImportReport,
} from "./contracts.js";
import { canonicalRemoteLinkIdentity, safeRemoteLinkUrl } from "./links.js";
import { failure } from "./reporting.js";

export async function importRemoteLinks(input: {
  migration: JiraRelatedImportInput;
  issueId: string;
  catalogReadSucceeded: boolean;
  remoteLinks: readonly JiraRemoteLinkPayload[];
  report: JiraRelatedImportReport;
}): Promise<void> {
  const { migration, issueId, catalogReadSucceeded, remoteLinks, report } =
    input;
  const remotePrefix = `jira-remote:${migration.jiraCloudId}:${issueId}:`;
  if (catalogReadSucceeded) {
    const currentRemoteKeys = new Set(
      remoteLinks.flatMap((remote) =>
        safeRemoteLinkUrl(remote.object.url)
          ? [`${remotePrefix}${canonicalRemoteLinkIdentity(remote)}`]
          : [],
      ),
    );
    let existingRemoteKeys: string[] = [];
    try {
      existingRemoteKeys =
        await migration.target.listExternalRefKeys(remotePrefix);
    } catch (error) {
      failure(
        report.failures,
        "remote_link",
        issueId,
        "read",
        "remote_link_target_catalog_read_failed",
        error,
      );
    }
    for (const existingKey of existingRemoteKeys) {
      if (currentRemoteKeys.has(existingKey)) continue;
      try {
        await migration.target.deleteExternalRef(existingKey);
        if (
          migration.mode === "apply" &&
          (await migration.target.readExternalRef(existingKey)) !== null
        )
          throw new Error("remote_link_delete_readback_mismatch");
      } catch (error) {
        failure(
          report.failures,
          "remote_link",
          `sha256:${fingerprintJiraState(existingKey)}`,
          String(error).includes("readback") ? "readback" : "write",
          "remote_link_source_reconciliation_failed",
          error,
        );
      }
    }
  }
  for (const remote of remoteLinks) {
    const remoteId = canonicalRemoteLinkIdentity(remote);
    const remoteReportId = `sha256:${fingerprintJiraState(remoteId)}`;
    const url = safeRemoteLinkUrl(remote.object.url);
    if (!url) {
      failure(
        report.failures,
        "remote_link",
        remoteReportId,
        "resolve",
        remote.object.url?.trim()
          ? "remote_link_url_invalid"
          : "remote_link_url_missing",
      );
      continue;
    }
    if (migration.mode === "apply") {
      try {
        const idempotencyKey = `${remotePrefix}${remoteId}`;
        const remoteValue = {
          reefId: migration.reefId,
          ref: { type: "url" as const, url, label: remote.object.title },
          provenance: {
            source: "jira",
            remote_identity: remoteId,
            global_id: remote.globalId ?? null,
            application: remote.application ?? null,
            relationship: remote.relationship ?? null,
            object: remote.object,
          },
        };
        const existing = await migration.target.readExternalRef(idempotencyKey);
        if (
          existing &&
          fingerprintJiraState(existing) === fingerprintJiraState(remoteValue)
        ) {
          report.remote_links.skipped += 1;
          continue;
        }
        await migration.target.putExternalRef({
          idempotencyKey,
          ...remoteValue,
        });
        const readback = await migration.target.readExternalRef(idempotencyKey);
        if (
          fingerprintJiraState(readback) !== fingerprintJiraState(remoteValue)
        )
          throw new Error("external_ref_readback_missing");
        report.remote_links.applied += 1;
      } catch (error) {
        failure(
          report.failures,
          "remote_link",
          remoteReportId,
          String(error).includes("readback") ? "readback" : "write",
          "remote_link_import_failed",
          error,
        );
      }
    }
  }
}
