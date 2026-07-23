import { join } from "node:path";
import {
  type JiraMigratorConfig,
  secretValuesForConfig,
} from "../cli/config.js";
import type { RawArchiveReference } from "../rawArchive.js";
import { createRawArchive } from "../rawArchive.js";
import type { discoverJiraMigrationSource } from "./sourceDiscovery.js";

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
      permissionVerification:
        process.platform === "win32"
          ? {
              kind: "external_acl",
              verified_by: targetActor,
              verified_at: runAt,
            }
          : { kind: "posix_mode", verified: true },
      forbiddenSecretValues: secretValuesForConfig(config),
    });
    archivesByProject.set(key, archive);
    const archivePages = async (
      endpointKind: string,
      pathname: string,
      pages: readonly unknown[],
    ): Promise<void> => {
      for (const [pageIndex, payload] of pages.entries()) {
        await archive.archive({
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
      await archivePages("field_catalog", "/rest/api/3/field", [
        fieldResult.raw,
      ]);
      for (const { boardId, catalog } of boardCatalogs) {
        await archivePages(
          `board_sprints:${boardId}`,
          `/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint`,
          catalog.pages,
        );
      }
    }
    await archivePages(
      "project_versions",
      `/rest/api/3/project/${encodeURIComponent(key)}/version`,
      versionPagesByProject.get(key) ?? [],
    );
    await archivePages(
      "issue_search",
      "/rest/api/3/search/jql",
      issuePagesByProject.get(key) ?? [],
    );
    for (const issue of issuesByProject.get(key) ?? []) {
      const issueReference = await archive.archive({
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
      let descriptionAdf: RawArchiveReference | undefined;
      if (issue.description !== null && typeof issue.description === "object") {
        descriptionAdf = await archive.archive({
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
      archiveReferences.set(issue.key, {
        issue: issueReference,
        ...(descriptionAdf ? { descriptionAdf } : {}),
      });
      for (const history of changelogByIssue.get(issue.key) ?? []) {
        const historyReference = await archive.archive({
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
        changelogArchiveReferences.set(
          `${issue.id}:${history.id}`,
          historyReference,
        );
      }
      await archivePages(
        `changelog:${issue.key}`,
        `/rest/api/3/issue/${encodeURIComponent(issue.key)}/changelog`,
        changelogPagesByIssue.get(issue.key) ?? [],
      );
    }
  }

  return {
    archiveReferences,
    changelogArchiveReferences,
    archiveSummaries,
    archivesByProject,
  };
}
