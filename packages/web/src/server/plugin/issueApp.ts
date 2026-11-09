import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import {
  type AkbAdapter,
  AuthError,
  IssueListQuerySchema,
  VaultNameSchema,
  akbIssueDocumentUri,
  akbListIssues,
  describeError,
} from "@reef/core";
import { z } from "zod";
import { logger } from "@/lib/logging/logger";
import { readInstallationTarget } from "@/server/adapters/installationTarget";
import { listActiveWorkspaces } from "@/server/application/workspaces/listActiveWorkspaces";
import { issueHtml } from "./issueHtml";
import {
  ISSUES_TOOL,
  IssuesResult,
  WORKSPACES_TOOL,
  WorkspacesResult,
} from "@/lib/reefPlugin/issueContract";
import { authenticateMcp, isResourceDenial, mcpAuthError } from "./oauth";
import { OAuthFailure } from "./oauthProtocol";

const UI_URI = "ui://reef/recent-issues.html";
const PAGE_SIZE = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const APP_ONLY = { ui: { visibility: ["app" as const] } };

async function activeWorkspaces(adapter: AkbAdapter) {
  if (!readInstallationTarget())
    throw new OAuthFailure("temporarily_unavailable", 503);
  return listActiveWorkspaces({ adapter });
}

function errorResult(
  error: "workspace_denied" | "unavailable" | "reauthentication_required",
) {
  return { isError: true, content: [], structuredContent: { error } };
}

export async function serveIssueApp(request: Request) {
  let adapter: AkbAdapter;
  try {
    adapter = await authenticateMcp(request);
  } catch (error) {
    return mcpAuthError(error);
  }

  let invalidAuth: AuthError | undefined;
  async function read<T extends Record<string, unknown>>(
    operation: () => Promise<T>,
  ) {
    try {
      return { content: [], structuredContent: await operation() };
    } catch (error) {
      if (isResourceDenial(error)) return errorResult("workspace_denied");
      if (error instanceof AuthError) {
        invalidAuth = error;
        return errorResult("reauthentication_required");
      }
      if (
        [403, 404].includes(
          error instanceof OAuthFailure
            ? error.status
            : describeError(error).status,
        )
      ) {
        return errorResult("workspace_denied");
      }
      logger.warn(
        { code: "plugin_read_unavailable" },
        "Reef plugin read failed",
      );
      return errorResult("unavailable");
    }
  }

  const server = new McpServer({ name: "reef", version: "1.0.0" });
  registerAppResource(server, "Reef recent issues", UI_URI, {}, async () => ({
    contents: [
      {
        uri: UI_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: issueHtml(),
        _meta: { ui: { prefersBorder: true } },
      },
    ],
  }));
  registerAppTool(
    server,
    "open_reef_issue_picker",
    {
      title: "Open Reef Issue Picker",
      description:
        "Open the Reef App to inspect recent issue snapshots in this conversation.",
      inputSchema: z.strictObject({}),
      annotations: READ_ONLY,
      _meta: {
        ui: { resourceUri: UI_URI },
        "openai/outputTemplate": UI_URI,
        "openai/ui": { entrypoints: [{ type: "thread" }] },
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "The Reef App displays recent issue snapshots for your workspace.",
        },
      ],
    }),
  );
  registerAppTool(
    server,
    WORKSPACES_TOOL,
    {
      description:
        "List active Reef workspaces accessible to the connected account.",
      inputSchema: z.strictObject({}),
      annotations: READ_ONLY,
      _meta: APP_ONLY,
    },
    () =>
      read(async () =>
        WorkspacesResult.parse({
          workspaces: await activeWorkspaces(adapter),
        }),
      ),
  );
  registerAppTool(
    server,
    ISSUES_TOOL,
    {
      description: "Read up to 50 recent issue snapshots in a Reef workspace.",
      inputSchema: z.strictObject({ workspace: VaultNameSchema }),
      annotations: READ_ONLY,
      _meta: APP_ONLY,
    },
    ({ workspace }) =>
      read(async () => {
        if (!(await activeWorkspaces(adapter)).includes(workspace)) {
          throw new OAuthFailure("workspace_denied", 403);
        }
        const now = Date.now();
        const queriedAt = new Date(now).toISOString();
        const { issues } = await akbListIssues({
          adapter,
          vault: workspace,
          query: IssueListQuerySchema.parse({
            date_range: {
              field: "updated_at",
              from: new Date(now - WEEK_MS).toISOString(),
              to: queriedAt,
            },
            sort_field: "updated_at",
            sort_order: "desc",
            limit: PAGE_SIZE,
          }),
        });
        return IssuesResult.parse({
          queried_at: queriedAt,
          issues: issues.map(({ id, title, status, updated_at }) => ({
            id,
            title,
            status,
            updated_at,
            document_uri: akbIssueDocumentUri(workspace, id),
          })),
        });
      }),
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    maxRequestBodySize: 64 * 1_024,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    if (invalidAuth) return mcpAuthError(invalidAuth);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return mcpAuthError(error);
  } finally {
    await server.close();
  }
}
