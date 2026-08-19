import { ZodError } from "zod";
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
const UUID_AUTHOR_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface HistoryTrailers {
  action: string | null;
  agent: string | null;
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
): Promise<IssueBodyHistoryEvent[]> {
  return withSpan(
    "akb.list_issue_body_history",
    { vault, reef_id: reefId },
    async (span) => {
      const path = issuePathFor(reefId);
      const payload = await adapter.request(
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
        const event = projectIssueBodyHistoryEntry(parsed.data);
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
