import type { JiraCatalogResult, JiraReadClient } from "../jira/client.js";
import type {
  JiraChangelogHistoryPayload,
  NormalizedJiraIssue,
  NormalizedJiraSprint,
} from "../payloads.js";
import { type RetryOperationOptions, retryOperation } from "./retry.js";

type RetryConfig = Pick<
  RetryOperationOptions,
  "maxRetries" | "baseDelayMs" | "maxDelayMs" | "sleep" | "random"
>;

export interface JiraIssueCatalog {
  items: NormalizedJiraIssue[];
  pages: unknown[];
}

export async function readAllChangelog(
  client: Pick<JiraReadClient, "listChangelog">,
  issueKey: string,
  retry: RetryConfig,
): Promise<JiraCatalogResult<JiraChangelogHistoryPayload>> {
  const items: JiraChangelogHistoryPayload[] = [];
  const pages: unknown[] = [];
  const rateLimits = [];
  let startAt = 0;
  while (true) {
    const page = await retryOperation(
      () => client.listChangelog(issueKey, { startAt }),
      { ...retry, operationKind: "read" },
    );
    items.push(...page.items);
    pages.push(page.raw);
    rateLimits.push(page.rateLimit);
    if (!page.cursor) break;
    if (page.cursor.kind !== "startAt" || page.cursor.value <= startAt) {
      throw new Error("jira_changelog_pagination_did_not_advance");
    }
    startAt = page.cursor.value;
  }
  return { items, pages, rateLimits };
}

export async function readAllProjectIssues(
  client: Pick<JiraReadClient, "searchProjectIssues">,
  projectKey: string,
  retry: RetryConfig,
): Promise<JiraIssueCatalog> {
  const items: NormalizedJiraIssue[] = [];
  const pages: unknown[] = [];
  const seenTokens = new Set<string>();
  let nextPageToken: string | undefined;
  while (true) {
    const page = await retryOperation(
      () =>
        client.searchProjectIssues({
          projectKey,
          nextPageToken,
          expand: ["properties"],
        }),
      { ...retry, operationKind: "read" },
    );
    items.push(...page.items);
    pages.push(page.raw);
    if (!page.cursor) break;
    if (page.cursor.kind !== "nextPageToken") {
      throw new Error("jira_issue_pagination_cursor_invalid");
    }
    if (seenTokens.has(page.cursor.value)) {
      throw new Error("jira_issue_pagination_token_repeated");
    }
    seenTokens.add(page.cursor.value);
    nextPageToken = page.cursor.value;
  }
  return { items, pages };
}

export async function readBoardSprints(
  client: Pick<JiraReadClient, "readBoardSprintCatalog">,
  boardIds: readonly string[],
  retry: RetryConfig,
): Promise<
  Array<{ boardId: string; catalog: JiraCatalogResult<NormalizedJiraSprint> }>
> {
  const results = [];
  for (const boardId of boardIds) {
    const catalog = await retryOperation(
      () => client.readBoardSprintCatalog(boardId),
      { ...retry, operationKind: "read" },
    );
    results.push({ boardId, catalog });
  }
  return results;
}
