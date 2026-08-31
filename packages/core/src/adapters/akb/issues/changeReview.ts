import {
  IssueChangeReviewRangeSchema,
  IssueChangeReviewResponseSchema,
  type IssueChange,
  type IssueChangeReviewResponse,
} from "../../../schemas/issues/changeReview";
import type { ActivityEvent } from "../../../schemas/issues/activity";
import type { Comment } from "../../../schemas/issues/comment";
import type { IssueAttachment } from "../../../schemas/issues/attachment";
import type { IssueBodyHistoryEvent } from "../../../schemas/issues/history";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { listVaultAttachments } from "./attachments";
import { listVaultComments } from "./comments";
import { listVaultActivity } from "./activity";
import { listIssueBodyHistory } from "./history";
import { listIssues } from "./listIssues";
import type {
  ListIssueChangeReviewParams,
  ListIssueChangeReviewResult,
} from "../core/types";
import { withSpan } from "../core/shared";

function instant(value: string): number {
  return Date.parse(value);
}

function inRange(value: string, startAt: string, endAt: string): boolean {
  const at = instant(value);
  return at >= instant(startAt) && at < instant(endAt);
}

function activityPayload(event: ActivityEvent): Record<string, unknown> {
  return event.payload as unknown as Record<string, unknown>;
}

/** Project one existing activity row into the period-review display model. */
function projectActivityChange(event: ActivityEvent): IssueChange | null {
  const payload = activityPayload(event);
  if (
    event.event_type === "attachment_added" ||
    event.event_type === "attachment_removed"
  ) {
    const kind = event.event_type;
    return {
      id: event.id,
      at: event.at,
      actor: event.actor,
      kind,
      attachment_id: String(payload.attachment_id),
      filename: String(payload.filename),
      file_uri: String(payload.file_uri),
      mime_type: String(payload.mime_type),
      size_bytes: Number(payload.size_bytes),
    } as IssueChange;
  }

  if (event.event_type === "impl_ref_linked") {
    return {
      id: event.id,
      at: event.at,
      actor: event.actor,
      kind: "field_change",
      event_type: event.event_type,
      field: "implementation_refs",
      from: null,
      to: {
        type: payload.ref_type,
        ref: payload.ref,
        repo: payload.repo,
      },
      payload,
    };
  }

  const field =
    event.event_type === "planning_link" ||
    event.event_type === "relation_change"
      ? String(payload.field ?? payload.relation ?? event.event_type)
      : event.event_type;
  const from =
    "from" in payload
      ? payload.from
      : "removed" in payload
        ? payload.removed
        : null;
  const to =
    "to" in payload ? payload.to : "added" in payload ? payload.added : null;
  return {
    id: event.id,
    at: event.at,
    actor: event.actor,
    kind: "field_change",
    event_type: event.event_type,
    field,
    from,
    to,
    payload,
  };
}

function projectCommentChange(comment: Comment): IssueChange {
  return {
    id: `comment:${comment.id}`,
    at: comment.created_at,
    actor: comment.author,
    kind: "comment_added",
    comment_id: comment.id,
    body: comment.body,
  };
}

function projectAttachmentChange(attachment: IssueAttachment): IssueChange {
  return {
    id: `attachment:${attachment.id}`,
    at: attachment.created_at,
    actor: attachment.author,
    kind: "attachment_added",
    attachment_id: attachment.id,
    filename: attachment.filename,
    file_uri: attachment.file_uri,
    mime_type: attachment.mime_type,
    size_bytes: attachment.size_bytes,
  };
}

function projectBodyChange(event: IssueBodyHistoryEvent): IssueChange {
  return {
    id: event.id,
    at: event.at,
    actor: event.actor,
    kind: "body_update",
    hash: event.hash,
    diff: event.diff ?? null,
  };
}

function projectCreatedChange(issue: IssueMetadata): IssueChange {
  return {
    id: `created:${issue.id}`,
    at: issue.created_at,
    actor: issue.created_by || null,
    kind: "created",
    title: issue.title,
  };
}

function compareChanges(left: IssueChange, right: IssueChange): number {
  return (
    instant(left.at) - instant(right.at) || left.id.localeCompare(right.id)
  );
}

function dedupeChanges(changes: IssueChange[]): IssueChange[] {
  const seen = new Set<string>();
  return changes.filter((change) => {
    const key =
      change.kind === "attachment_added" || change.kind === "attachment_removed"
        ? `${change.kind}:${change.attachment_id}`
        : change.kind === "comment_added"
          ? `comment:${change.comment_id}`
          : change.kind === "body_update"
            ? `body:${change.hash}`
            : change.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Collect all preserved change sources for one normalized half-open period.
 * The issue, activity, comment, and attachment tables are read without a
 * caller-facing page limit. Document history uses the public stateless MCP
 * history contract so the REST 100-entry ceiling cannot truncate a review.
 */
export async function listIssueChangeReview(
  params: ListIssueChangeReviewParams,
): Promise<ListIssueChangeReviewResult> {
  const { adapter, vault } = params;
  return withSpan("akb.list_issue_change_review", { vault }, async (span) => {
    const parsedRange = IssueChangeReviewRangeSchema.parse(params.range);
    const startAt = new Date(parsedRange.start_at).toISOString();
    const endAt = new Date(parsedRange.end_at).toISOString();
    const { issues } = await listIssues({ adapter, vault });
    const [activity, comments, attachments, histories] = await Promise.all([
      listVaultActivity(adapter, vault),
      listVaultComments(adapter, vault),
      listVaultAttachments(adapter, vault),
      Promise.all(
        issues.map(async (issue) => ({
          issueId: issue.id,
          events: await listIssueBodyHistory(adapter, vault, issue.id, {
            complete: true,
          }),
        })),
      ),
    ]);

    const changesByIssue = new Map<string, IssueChange[]>();
    const add = (issueId: string, change: IssueChange): void => {
      if (!inRange(change.at, startAt, endAt)) return;
      const current = changesByIssue.get(issueId) ?? [];
      current.push(change);
      changesByIssue.set(issueId, current);
    };

    for (const issue of issues) {
      if (inRange(issue.created_at, startAt, endAt)) {
        add(issue.id, projectCreatedChange(issue));
      }
    }
    for (const event of activity) {
      if (!inRange(event.at, startAt, endAt)) continue;
      const change = projectActivityChange(event);
      if (change) add(event.reef_id, change);
    }
    for (const comment of comments) {
      add(comment.reef_id, projectCommentChange(comment));
    }
    for (const attachment of attachments) {
      add(attachment.reef_id, projectAttachmentChange(attachment));
    }
    for (const history of histories) {
      for (const event of history.events) {
        add(history.issueId, projectBodyChange(event));
      }
    }

    const issueById = new Map(issues.map((issue) => [issue.id, issue]));
    const groups = [...changesByIssue.entries()]
      .map(([issueId, changes]) => ({
        issue: issueById.get(issueId),
        changes: dedupeChanges(changes).sort(compareChanges),
      }))
      .filter(
        (group): group is { issue: IssueMetadata; changes: IssueChange[] } =>
          group.issue !== undefined && group.changes.length > 0,
      )
      .sort((left, right) => {
        const leftFirst = left.changes[0];
        const rightFirst = right.changes[0];
        if (!leftFirst || !rightFirst) {
          return left.issue.id.localeCompare(right.issue.id);
        }
        return (
          compareChanges(leftFirst, rightFirst) ||
          left.issue.id.localeCompare(right.issue.id)
        );
      });

    const result = IssueChangeReviewResponseSchema.parse({
      start_at: startAt,
      end_at: endAt,
      groups,
    });
    span.setAttribute("issue_count", result.groups.length);
    span.setAttribute(
      "change_count",
      result.groups.reduce((count, group) => count + group.changes.length, 0),
    );
    return result;
  });
}
