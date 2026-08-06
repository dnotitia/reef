import type { Template } from "../../schemas/issues/template";
import type { PlanningCatalog } from "../../schemas/planning/catalog";
import { templateToCatalogItem } from "../prompts/templateCatalog";
import { extractIssueRef } from "./issueRefs";
import type { CommitNode, NormalisedActivity, PrNode } from "./types";

export function normalizeActivities({
  commitNodes,
  prNodes,
  dismissedRefs,
  issueIdRegex,
  issueTemplates,
  planningCatalog,
  repoFull,
}: {
  commitNodes: readonly CommitNode[];
  prNodes: readonly PrNode[];
  dismissedRefs: ReadonlySet<string>;
  issueIdRegex: RegExp;
  issueTemplates: readonly Template[];
  planningCatalog: PlanningCatalog | undefined;
  repoFull: string;
}): NormalisedActivity[] {
  const templateCatalog = issueTemplates.map(templateToCatalogItem);
  const prNumbers = new Set(prNodes.map((pr) => pr.number));
  const activities: NormalisedActivity[] = [];

  const dismissKey = (type: "commit" | "pr", ref: string): string =>
    `${repoFull}:${type}:${ref}`;

  for (const commit of commitNodes) {
    const assocPrNumbers = commit.associatedPullRequests.nodes.map(
      (p) => p.number,
    );
    if (assocPrNumbers.some((n) => prNumbers.has(n))) continue;
    if (dismissedRefs.has(dismissKey("commit", commit.oid))) continue;

    const actor =
      commit.author?.user?.login ?? commit.author?.name ?? "unknown";
    const issueRef = extractIssueRef(commit.message, issueIdRegex);
    activities.push({
      type: "commit",
      ref: commit.oid,
      actor,
      repo: repoFull,
      issueRef,
      link: issueRef ? { source: "explicit" } : null,
      draftPromptRequest: {
        activity: {
          eventType: "commit",
          actor,
          sourceRepo: repoFull,
          commit: {
            hash: commit.oid,
            message: commit.message,
            branch: "default",
            authoredDate: commit.authoredDate,
            committedDate: commit.committedDate,
            changedFiles: [],
          },
        },
        templateCatalog,
        planningCatalog,
      },
      noteInput: {
        commit: {
          hash: commit.oid,
          message: commit.message,
          branch: "default",
          authoredDate: commit.authoredDate,
          committedDate: commit.committedDate,
          changedFiles: [],
        },
      },
    });
  }

  for (const pr of prNodes) {
    const refStr = String(pr.number);
    if (dismissedRefs.has(dismissKey("pr", refStr))) continue;

    const actor = pr.author?.login ?? "unknown";
    const issueRef = extractIssueRef(
      [
        pr.title,
        pr.body ?? "",
        pr.headRefName,
        ...pr.commits.nodes.map((n) => n.commit.message),
      ].join(" "),
      issueIdRegex,
    );
    activities.push({
      type: "pr",
      ref: refStr,
      actor,
      repo: repoFull,
      issueRef,
      link: issueRef ? { source: "explicit" } : null,
      draftPromptRequest: {
        activity: {
          eventType: "pr",
          actor,
          sourceRepo: repoFull,
          pr: {
            number: pr.number,
            title: pr.title,
            headBranch: pr.headRefName,
            body: pr.body ?? undefined,
            createdAt: pr.createdAt,
            updatedAt: pr.updatedAt,
            mergedAt: pr.mergedAt,
            commitMessages: pr.commits.nodes.map((n) => n.commit.message),
          },
        },
        templateCatalog,
        planningCatalog,
      },
      noteInput: {
        pr: {
          number: pr.number,
          title: pr.title,
          headBranch: pr.headRefName,
          body: pr.body ?? undefined,
          createdAt: pr.createdAt,
          updatedAt: pr.updatedAt,
          mergedAt: pr.mergedAt,
          commitMessages: pr.commits.nodes.map((n) => n.commit.message),
        },
      },
    });
  }

  return activities;
}
