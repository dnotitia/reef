import { join } from "node:path";
import {
  type JiraMigratorConfig,
  secretValuesForConfig,
} from "../cli/config.js";
import type {
  ArchiveRawPayloadInput,
  RawArchiveReference,
} from "../rawArchive.js";
import { createRawArchive } from "../rawArchive.js";
import type { discoverJiraMigrationSource } from "./sourceDiscovery.js";

export const runnerArchivePermissionVerification = (
  platform: NodeJS.Platform = process.platform,
): { kind: "posix_mode"; verified: true } => {
  if (platform === "win32") {
    throw new Error("windows_external_acl_verification_required");
  }
  return { kind: "posix_mode", verified: true };
};

export async function archiveJiraMigrationSource(input: {
  config: JiraMigratorConfig;
  archiveRoot: string;
  runAt: string;
  targetActor: string;
  discovery: Awaited<ReturnType<typeof discoverJiraMigrationSource>>;
}) {
  const { config, archiveRoot, runAt, targetActor, discovery } = input;
  const {
    fieldResult,
    boardCatalogs,
    versionPagesByProject,
    issuePagesByProject,
    issuesByProject,
    changelogPagesByIssue,
    changelogByIssue,
  } = discovery;
  const archiveReferences = new Map<
    string,
    { issue: RawArchiveReference; descriptionAdf?: RawArchiveReference }
  >();
  const changelogArchiveReferences = new Map<string, RawArchiveReference>();
  const archiveSummaries: Array<
    { project_key: string } & Awaited<
      ReturnType<ReturnType<typeof createRawArchive>["verify"]>
    >
  > = [];
  const archivesByProject = new Map<
    string,
    ReturnType<typeof createRawArchive>
  >();
  for (const key of config.jira.projectKeys) {
    const archive = createRawArchive({
      root: join(archiveRoot, key.toLowerCase()),
      runId: config.artifacts.runId,
      sourceScope: { cloud_id: config.jira.cloudId, project_key: key },
      createdAt: runAt,
      retention: {
        owner: targetActor,
        retention_until: new Date(
          Date.parse(runAt) + 7 * 365 * 24 * 60 * 60 * 1_000,
        ).toISOString(),
        policy_ref: "docs/jira-migration.md",
      },
      permissionVerification: runnerArchivePermissionVerification(),
      forbiddenSecretValues: secretValuesForConfig(config),
    });
    archivesByProject.set(key, archive);
    const pendingInputs: ArchiveRawPayloadInput[] = [];
    const issueBindings: Array<{
      issueKey: string;
      issueIndex: number;
      descriptionIndex?: number;
    }> = [];
    const changelogBindings: Array<{
      sourceKey: string;
      referenceIndex: number;
    }> = [];
    const enqueue = (archiveInput: ArchiveRawPayloadInput): number =>
      pendingInputs.push(archiveInput) - 1;
    const archivePages = (
      endpointKind: string,
      pathname: string,
      pages: readonly unknown[],
    ): void => {
      for (const [pageIndex, payload] of pages.entries()) {
        enqueue({
          entityKind: "response_page",
          sourceIdentity: {
            cloud_id: config.jira.cloudId,
            project_key: key,
            endpoint_kind: endpointKind,
            page_index: String(pageIndex),
          },
          sourceEndpoint: { method: "GET", pathname },
          classification: "restricted_pii",
          fetchedAt: runAt,
          payload,
        });
      }
    };
    if (key === config.jira.projectKeys[0]) {
      archivePages("field_catalog", "/rest/api/3/field", [fieldResult.raw]);
      for (const { boardId, catalog } of boardCatalogs) {
        archivePages(
          `board:${boardId}`,
          `/rest/agile/1.0/board/${encodeURIComponent(boardId)}`,
          [catalog.boardRaw],
        );
        archivePages(
          `board_sprints:${boardId}`,
          `/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint`,
          catalog.pages,
        );
      }
    }
    archivePages(
      "project_versions",
      `/rest/api/3/project/${encodeURIComponent(key)}/version`,
      versionPagesByProject.get(key) ?? [],
    );
    archivePages(
      "issue_search",
      "/rest/api/3/search/jql",
      issuePagesByProject.get(key) ?? [],
    );
    for (const issue of issuesByProject.get(key) ?? []) {
      const issueIndex = enqueue({
        entityKind: "issue",
        sourceIdentity: {
          cloud_id: config.jira.cloudId,
          project_key: key,
          issue_id: issue.id,
        },
        sourceEndpoint: {
          method: "GET",
          pathname: "/rest/api/3/search/jql",
        },
        classification: "restricted_pii",
        fetchedAt: runAt,
        payload: issue.raw,
      });
      let descriptionIndex: number | undefined;
      if (issue.description !== null && typeof issue.description === "object") {
        descriptionIndex = enqueue({
          entityKind: "description_adf",
          sourceIdentity: {
            cloud_id: config.jira.cloudId,
            issue_id: issue.id,
            entity_kind: "description_adf",
          },
          sourceEndpoint: {
            method: "GET",
            pathname: "/rest/api/3/search/jql",
          },
          classification: "restricted_pii",
          fetchedAt: runAt,
          payload: issue.description,
        });
      }
      issueBindings.push({
        issueKey: issue.key,
        issueIndex,
        ...(descriptionIndex === undefined ? {} : { descriptionIndex }),
      });
      for (const history of changelogByIssue.get(issue.key) ?? []) {
        const referenceIndex = enqueue({
          entityKind: "changelog_history",
          sourceIdentity: {
            cloud_id: config.jira.cloudId,
            issue_id: issue.id,
            history_id: history.id,
          },
          sourceEndpoint: {
            method: "GET",
            pathname: `/rest/api/3/issue/${encodeURIComponent(issue.key)}/changelog`,
          },
          classification: "restricted_pii",
          fetchedAt: runAt,
          payload: history,
        });
        changelogBindings.push({
          sourceKey: `${issue.id}:${history.id}`,
          referenceIndex,
        });
      }
      archivePages(
        `changelog:${issue.key}`,
        `/rest/api/3/issue/${encodeURIComponent(issue.key)}/changelog`,
        changelogPagesByIssue.get(issue.key) ?? [],
      );
    }
    const references = await archive.archiveMany(pendingInputs);
    for (const binding of issueBindings) {
      const issueReference = references[binding.issueIndex];
      if (!issueReference) throw new Error("raw_archive_reference_missing");
      const descriptionAdf =
        binding.descriptionIndex === undefined
          ? undefined
          : references[binding.descriptionIndex];
      if (binding.descriptionIndex !== undefined && !descriptionAdf) {
        throw new Error("raw_archive_reference_missing");
      }
      archiveReferences.set(binding.issueKey, {
        issue: issueReference,
        ...(descriptionAdf ? { descriptionAdf } : {}),
      });
    }
    for (const binding of changelogBindings) {
      const reference = references[binding.referenceIndex];
      if (!reference) throw new Error("raw_archive_reference_missing");
      changelogArchiveReferences.set(binding.sourceKey, reference);
    }
  }

  return {
    archiveReferences,
    changelogArchiveReferences,
    archiveSummaries,
    archivesByProject,
  };
}
