import { ZodError, z } from "zod";
import { SchemaValidationError } from "../../../errors";
import {
  AkbDocumentHistoryEntrySchema,
  AkbDocumentHistoryResponseSchema,
  type AkbDocumentHistoryEntry,
  type AkbDocumentHistoryResponse,
  type IssueBodyHistoryEvent,
  IssueBodyHistoryEventSchema,
} from "../../../schemas/issues/history";
import { issueDocumentUri, issuePathFor } from "../core/paths";
import { type AkbAdapter, withSpan } from "../core/shared";

const HISTORY_LIMIT = 100;
// REST history is capped at 100 and has no cursor. The public stateless MCP
// history contract accepts a larger integer and walks the complete native
// revision lineage, so complete review reads use the largest PostgreSQL-safe
// integer instead of silently dropping a 101st (or later) revision.
const COMPLETE_HISTORY_LIMIT = 2_147_483_647;
const MCP_PROTOCOL_VERSION = "2026-07-28";
const UUID_AUTHOR_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface HistoryTrailers {
  action: string | null;
  agent: string | null;
}

export interface IssueBodyHistoryOptions {
  /** Use the uncapped stateless MCP history contract. */
  complete?: boolean;
}

/**
 * Read the canonical trailer block at the end of a commit message. Parsing is
 * line-based and key-exact: `x-action:` and prose containing `action:` are not
 * treated as trailers. A blank line may separate the body from the trailers.
 */
export function parseHistoryTrailers(message: string): HistoryTrailers {
  const lines = message.replace(/\r\n?/gu, "\n").split("\n");
  const trailers = new Map<string, string>();
  let foundTrailer = false;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      if (foundTrailer) break;
      continue;
    }
    const match = /^([a-z][a-z0-9_-]*):[ \t]*(.*?)\s*$/u.exec(line);
    if (!match) break;
    foundTrailer = true;
    const [, key, value] = match;
    if (key && value && !trailers.has(key)) {
      trailers.set(key, value.trim());
    }
  }

  return {
    action: trailers.get("action") ?? null,
    agent: trailers.get("agent") ?? null,
  };
}

function visibleActor(value: string | null | undefined): string | null {
  const actor = value?.trim();
  if (
    !actor ||
    actor.toLowerCase() === "unknown" ||
    UUID_AUTHOR_RE.test(actor)
  ) {
    return null;
  }
  return actor;
}

/**
 * Project one validated AKB history entry into Reef's body-update read model.
 * Only the exact `action: update` trailer is user-visible; the raw commit
 * message and opaque `author` value never cross the web boundary.
 */
export function projectIssueBodyHistoryEntry(
  entry: AkbDocumentHistoryEntry,
  diff?: string | null,
): IssueBodyHistoryEvent | null {
  const { action, agent } = parseHistoryTrailers(entry.message);
  if (action !== "update") return null;

  const actor = visibleActor(entry.author_name) ?? visibleActor(agent);
  return IssueBodyHistoryEventSchema.parse({
    id: `body-update:${entry.hash}`,
    hash: entry.hash,
    at: entry.date,
    actor,
    kind: "body_update",
    ...(diff !== undefined ? { diff } : {}),
  });
}

function historyResponseError(err: ZodError): SchemaValidationError {
  return new SchemaValidationError({
    issues: err.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    ),
  });
}

/**
 * Fetch the canonical issue document history and project body updates at
 * read-time. No Reef table or document is written. Invalid entries are
 * skipped individually while an invalid envelope fails the history query.
 */
export async function listIssueBodyHistory(
  adapter: AkbAdapter,
  vault: string,
  reefId: string,
  options: IssueBodyHistoryOptions = {},
): Promise<IssueBodyHistoryEvent[]> {
  return withSpan(
    "akb.list_issue_body_history",
    { vault, reef_id: reefId },
    async (span) => {
      const path = issuePathFor(reefId);
      const payload = options.complete
        ? await requestMcpTool(adapter, "akb_history", {
            uri: issueDocumentUri(vault, reefId),
            limit: COMPLETE_HISTORY_LIMIT,
          })
        : await adapter.request(
            `/api/v1/history/${encodeURIComponent(vault)}/${path}`,
            {
              query: { limit: HISTORY_LIMIT },
              resource: `document history ${path}`,
            },
          );

      let response: AkbDocumentHistoryResponse;
      try {
        response = AkbDocumentHistoryResponseSchema.parse(payload);
      } catch (err) {
        if (err instanceof ZodError) throw historyResponseError(err);
        throw err;
      }

      const expectedUri = issueDocumentUri(vault, reefId);
      if (response.uri !== expectedUri) {
        throw new SchemaValidationError({
          issues: ["history.uri: does not match the canonical issue document"],
        });
      }

      const events: IssueBodyHistoryEvent[] = [];
      let malformedCount = 0;
      let ignoredCount = 0;
      for (const rawEntry of response.history) {
        const parsed = AkbDocumentHistoryEntrySchema.safeParse(rawEntry);
        if (!parsed.success) {
          malformedCount += 1;
          continue;
        }

        const { action } = parseHistoryTrailers(parsed.data.message);
        if (action !== "update") {
          ignoredCount += 1;
          continue;
        }

        let diff: string | null | undefined;
        if (options.complete) {
          const documentDiff = await requestDocumentDiff(
            adapter,
            vault,
            path,
            parsed.data.hash,
          );
          if (
            documentDiff.type === "unknown" ||
            documentDiff.type === "unchanged"
          ) {
            ignoredCount += 1;
            continue;
          }
          diff = bodyDiffFromDocumentDiff(documentDiff.diff);
          if (diff === null) {
            ignoredCount += 1;
            continue;
          }
        }
        const event = projectIssueBodyHistoryEntry(parsed.data, diff);
        if (event) events.push(event);
        else ignoredCount += 1;
      }

      span.setAttribute("history_entry_count", response.history.length);
      span.setAttribute("body_update_count", events.length);
      span.setAttribute("malformed_entry_count", malformedCount);
      span.setAttribute("ignored_entry_count", ignoredCount);
      return events;
    },
  );
}

const McpToolCallResponseSchema = z.object({
  result: z
    .object({
      content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
      isError: z.boolean().optional(),
    })
    .optional(),
  error: z.unknown().optional(),
});

/**
 * Call one read-only AKB MCP tool through the public stateless modern
 * Streamable HTTP transport. Ordinary Reef AKB I/O remains on REST; complete
 * history is the one public contract whose REST twin cannot carry the required
 * range.
 */
async function requestMcpTool(
  adapter: AkbAdapter,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const payload = await adapter.request("/mcp/", {
    method: "POST",
    rawHeaders: {
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
    body: {
      jsonrpc: "2.0",
      id: `reef-${name}`,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: "reef-web",
            version: "1",
          },
        },
      },
    },
    resource: `AKB MCP ${name}`,
  });

  const response = McpToolCallResponseSchema.safeParse(payload);
  if (!response.success) {
    throw new SchemaValidationError({
      issues: ["AKB MCP response envelope is invalid"],
    });
  }
  if (response.data.error) {
    throw new SchemaValidationError({
      issues: ["AKB MCP history request failed"],
    });
  }
  const text = response.data.result?.content[0]?.text;
  if (!text || response.data.result?.isError) {
    throw new SchemaValidationError({
      issues: ["AKB MCP history response is empty"],
    });
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new SchemaValidationError({
      issues: ["AKB MCP history result is not JSON"],
    });
  }
  if (typeof decoded === "object" && decoded !== null && "error" in decoded) {
    throw new SchemaValidationError({
      issues: ["AKB MCP history request failed"],
    });
  }
  return decoded;
}

const DocumentDiffResponseSchema = z.object({
  file: z.string(),
  commit: z.string(),
  type: z.enum(["added", "deleted", "modified", "unknown", "unchanged"]),
  diff: z.string(),
  error: z.string().nullable().optional(),
});

type DocumentDiffType = z.infer<typeof DocumentDiffResponseSchema>["type"];

/**
 * Remove AKB's YAML frontmatter from a unified document diff. Issue documents
 * store title, labels, and relations in that frontmatter while their Markdown
 * body is the user-visible content. A document `action:update` therefore does
 * not prove a body edit by itself: a title-only or relation-only save also
 * creates one. Returning null for a diff with no body additions/removals keeps
 * those metadata commits out of the body-change review without changing the
 * existing detail-history consumer.
 */
export function bodyDiffFromDocumentDiff(diff: string): string | null {
  const lines = diff.replace(/\r\n?/gu, "\n").split("\n");
  const hasUnifiedHeaders =
    lines[0]?.startsWith("--- ") === true &&
    lines[1]?.startsWith("+++ ") === true;
  const contentLines = hasUnifiedHeaders ? lines.slice(2) : lines;

  let frontmatterStarted = false;
  let frontmatterClosed = false;
  const bodyLines: string[] = [];
  let hasBodyChange = false;

  for (const line of contentLines) {
    if (line.startsWith("@@")) continue;
    const prefix = line[0];
    const content =
      prefix === " " || prefix === "+" || prefix === "-" ? line.slice(1) : line;

    if (!frontmatterStarted && content === "---") {
      frontmatterStarted = true;
      continue;
    }
    if (
      frontmatterStarted &&
      !frontmatterClosed &&
      prefix === " " &&
      content === "---"
    ) {
      frontmatterClosed = true;
      continue;
    }
    if (!frontmatterStarted || frontmatterClosed) {
      if (prefix === "+" || prefix === "-") hasBodyChange = true;
      if (frontmatterClosed || !frontmatterStarted) bodyLines.push(line);
    }
  }

  if (!hasBodyChange) return null;
  return bodyLines.join("\n").trim() || null;
}

async function requestDocumentDiff(
  adapter: AkbAdapter,
  vault: string,
  path: string,
  commit: string,
): Promise<{ type: DocumentDiffType; diff: string }> {
  const payload = await adapter.request(
    `/api/v1/diff/${encodeURIComponent(vault)}/${path}`,
    {
      query: { commit },
      resource: `document diff ${path}`,
    },
  );
  const parsed = DocumentDiffResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SchemaValidationError({
      issues: ["document diff response is invalid"],
    });
  }
  if (parsed.data.type === "unknown" || parsed.data.type === "unchanged") {
    return {
      type: parsed.data.type,
      diff: "",
    };
  }
  return {
    type: parsed.data.type,
    diff: parsed.data.diff,
  };
}
