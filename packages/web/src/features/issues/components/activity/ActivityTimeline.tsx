"use client";

import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { useCreateComment } from "@/features/issues/hooks/mutations/useCreateComment";
import { useUpdateComment } from "@/features/issues/hooks/mutations/useUpdateComment";
import { useActivity } from "@/features/issues/hooks/queries/useActivity";
import { useComments } from "@/features/issues/hooks/queries/useComments";
import type { ActivityEvent, Comment, IssueMetadata } from "@reef/core";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CommentCard } from "../comments/CommentCard";
import { CommentComposer } from "../comments/CommentComposer";
import { ISSUE_SECTION_HEADER_CLASS } from "../shared/IssueFormSection";
import { ActivityEventRow } from "./ActivityEventRow";
import { CollapsedEventsRow } from "./CollapsedEventsRow";
import { buildTimeline } from "./timelineModel";

interface ActivityTimelineProps {
  issueId: string;
  vault: string;
  /** The loaded issue — source of the reconstructed events (created/delivery/closed). */
  issue: IssueMetadata;
}

// Stable empty defaults so the `buildTimeline` memo isn't re-run on every render
// while a query is still loading (referential stability).
const NO_COMMENTS: Comment[] = [];
const NO_ACTIVITY: ActivityEvent[] = [];

/**
 * The issue detail's unified "Activity" section (REEF-064). It owns its own data
 * + comment mutations (like the comments section it replaces) and merges three
 * sources at render time — comments, status-change activity, and events
 * reconstructed from the issue's own fields — into one chronological feed.
 * Comments render as avatar-gutter cards; system and reconstructed events render
 * as a lighter glyph-node line. Every node (avatar, glyph, composer) shares one
 * left gutter so the feed reads as a single column, with no connecting rail. No
 * new storage and no unified table — the merge is pure (AC4).
 */
export function ActivityTimeline({
  issueId,
  vault,
  issue,
}: ActivityTimelineProps) {
  const currentLogin = useCurrentUserLogin();
  const { data: comments = NO_COMMENTS, isError: commentsError } = useComments(
    issueId,
    vault,
  );
  const { data: activity = NO_ACTIVITY, isError: activityError } = useActivity(
    issueId,
    vault,
  );
  const createComment = useCreateComment();
  const updateComment = useUpdateComment();
  const [flashId, setFlashId] = useState<string | null>(null);

  const timeline = useMemo(
    () => buildTimeline(comments, activity, issue),
    [comments, activity, issue],
  );

  async function handleCreate(body: string) {
    try {
      const created = await createComment.mutateAsync({ issueId, vault, body });
      setFlashId(created.id);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't add comment. Try again.",
      );
      throw err; // keep the composer's text for a retry
    }
  }

  async function handleEdit(commentId: string, body: string) {
    try {
      await updateComment.mutateAsync({ issueId, vault, commentId, body });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't save the edit. Try again.",
      );
      throw err; // keep the card in edit mode
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className={ISSUE_SECTION_HEADER_CLASS}>Activity</h3>

      <div className="flex min-w-0 flex-col gap-4">
        {timeline.map((entry) => {
          if (entry.type === "comment") {
            return (
              <CommentCard
                key={entry.comment.id}
                comment={entry.comment}
                currentLogin={currentLogin}
                flash={entry.comment.id === flashId}
                onSave={(body) => handleEdit(entry.comment.id, body)}
              />
            );
          }
          if (entry.type === "collapsed") {
            return (
              <CollapsedEventsRow
                key={`collapsed:${entry.events[0].event.id}`}
                events={entry.events}
                vault={vault}
              />
            );
          }
          return (
            <ActivityEventRow
              key={entry.event.id}
              event={entry.event}
              vault={vault}
            />
          );
        })}

        <CommentComposer
          currentLogin={currentLogin}
          pending={createComment.isPending}
          onSubmit={handleCreate}
        />
      </div>

      {commentsError || activityError ? (
        <p className="text-xs text-destructive">
          Couldn't load the full activity. Try again.
        </p>
      ) : null}
    </section>
  );
}
