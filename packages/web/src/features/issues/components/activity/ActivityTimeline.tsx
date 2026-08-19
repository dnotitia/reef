"use client";

import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { useCreateComment } from "@/features/issues/hooks/mutations/useCreateComment";
import { useDeleteComment } from "@/features/issues/hooks/mutations/useDeleteComment";
import { useUpdateComment } from "@/features/issues/hooks/mutations/useUpdateComment";
import { useUploadIssueAttachment } from "@/features/issues/hooks/mutations/useUploadIssueAttachment";
import { useActivity } from "@/features/issues/hooks/queries/useActivity";
import { useComments } from "@/features/issues/hooks/queries/useComments";
import { useIssueBodyHistory } from "@/features/issues/hooks/queries/useIssueBodyHistory";
import { resolveIssueAttachmentUrl } from "@/features/issues/lib/attachmentUrls";
import { useVaultRoster } from "@/features/settings/hooks/useVaultRoster";
import type {
  ActivityEvent,
  Comment,
  IssueListItem,
  IssueMetadata,
} from "@reef/core";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
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
  /** Same loaded issue context the body renderer uses for known references. */
  knownIssues: readonly IssueListItem[];
}

// Stable empty defaults so the `buildTimeline` memo isn't re-run on every render
// while a query is still loading (referential stability).
const NO_COMMENTS: Comment[] = [];
const NO_ACTIVITY: ActivityEvent[] = [];
const NO_BODY_HISTORY: never[] = [];
const NO_VAULT_MEMBERS: never[] = [];

/**
 * The issue detail's unified "Activity" section (REEF-064). It owns its own data
 * + comment mutations (like the comments section it replaces) and merges four
 * sources at render time — comments, activity, read-time document body history,
 * and events reconstructed from the issue's own fields — into one chronological
 * feed. Comments render as avatar-gutter cards; system and reconstructed events
 * render as a lighter glyph-node line. Every node (avatar, glyph, composer)
 * shares one left gutter so the feed reads as a single column, with no
 * connecting rail. No new storage and no unified table — the merge is pure
 * (AC4).
 */
export function ActivityTimeline({
  issueId,
  vault,
  issue,
  knownIssues,
}: ActivityTimelineProps) {
  const t = useTranslations("toasts");
  const nav = useTranslations("nav");
  const ta = useTranslations("issues.activity");
  const currentLogin = useCurrentUserLogin();
  const { data: vaultMembers = NO_VAULT_MEMBERS } = useVaultRoster(vault);
  const { data: comments = NO_COMMENTS, isError: commentsError } = useComments(
    issueId,
    vault,
  );
  const { data: activity = NO_ACTIVITY, isError: activityError } = useActivity(
    issueId,
    vault,
  );
  const { data: bodyHistory = NO_BODY_HISTORY, isError: bodyHistoryError } =
    useIssueBodyHistory(issueId, vault);
  const createComment = useCreateComment();
  const deleteComment = useDeleteComment();
  const updateComment = useUpdateComment();
  const uploadAttachment = useUploadIssueAttachment();
  const [flashId, setFlashId] = useState<string | null>(null);
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);

  const timeline = useMemo(
    () => buildTimeline(comments, activity, issue, bodyHistory),
    [comments, activity, issue, bodyHistory],
  );
  const commentIds = useMemo(
    () => new Set(comments.map((comment) => comment.id)),
    [comments],
  );
  const knownIssueIds = useMemo(
    () => new Set(knownIssues.map((candidate) => candidate.id)),
    [knownIssues],
  );

  useEffect(() => {
    if (!issueId) return;
    const hash = window.location.hash;
    if (!hash.startsWith("#comment-")) return;

    let targetId: string;
    try {
      targetId = decodeURIComponent(hash.slice(1));
    } catch {
      targetId = "";
    }
    const sourceRef = targetId.startsWith("comment-")
      ? targetId.slice("comment-".length)
      : "";
    const target =
      sourceRef && commentIds.has(sourceRef)
        ? document.getElementById(targetId)
        : null;
    const fallback = document.getElementById("issue-activity");
    (target ?? fallback)?.scrollIntoView({ block: "start" });
  }, [commentIds, issueId]);

  const resolveMarkdownUrl = useMemo(
    () => (url: string, key: string) =>
      resolveIssueAttachmentUrl({ issueId, vault, url, key }),
    [issueId, vault],
  );

  async function handleCreate(body: string, parentCommentId?: string) {
    try {
      const created = await createComment.mutateAsync({
        issueId,
        vault,
        body,
        parentCommentId,
      });
      setFlashId(created.id);
      if (parentCommentId) setReplyTargetId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("commentAddError"));
      throw err; // keep the composer's text for a retry
    }
  }

  async function handleEdit(commentId: string, body: string) {
    try {
      await updateComment.mutateAsync({ issueId, vault, commentId, body });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("commentEditError"));
      throw err; // keep the card in edit mode
    }
  }

  async function handleDelete(commentId: string) {
    try {
      await deleteComment.mutateAsync({ issueId, vault, commentId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("commentDeleteError"));
      throw err;
    }
  }

  async function handleUploadFiles(files: File[]) {
    return Promise.all(
      files.map((file) =>
        uploadAttachment.mutateAsync({
          issueId,
          vault,
          file,
          source: "comment",
          inline: file.type.startsWith("image/"),
        }),
      ),
    );
  }

  return (
    <section
      id="issue-activity"
      className="scroll-mt-4 flex min-w-0 flex-col gap-3"
    >
      <h3 className={ISSUE_SECTION_HEADER_CLASS}>{nav("activity")}</h3>

      <div className="flex min-w-0 flex-col gap-4">
        {timeline.map((entry) => {
          if (entry.type === "comment") {
            const threadComments = [entry.comment, ...entry.replies];
            const authorById = new Map(
              threadComments.map((comment) => [comment.id, comment.author]),
            );
            const replyTarget = threadComments.find(
              (comment) => comment.id === replyTargetId,
            );
            return (
              <div
                key={entry.comment.id}
                data-testid="comment-thread"
                className="flex min-w-0 flex-col gap-2"
              >
                <CommentCard
                  comment={entry.comment}
                  currentLogin={currentLogin}
                  members={vaultMembers}
                  flash={entry.comment.id === flashId}
                  onSave={(body) => handleEdit(entry.comment.id, body)}
                  onDelete={() => handleDelete(entry.comment.id)}
                  onReply={() => setReplyTargetId(entry.comment.id)}
                  resolveMarkdownUrl={resolveMarkdownUrl}
                  knownIssueIds={knownIssueIds}
                  vault={vault}
                />
                {entry.replies.length > 0 || replyTarget ? (
                  <div className="ml-11 flex min-w-0 flex-col gap-3 border-l border-border-subtle pl-3 sm:ml-12">
                    {replyTarget?.id === entry.comment.id ? (
                      <CommentComposer
                        currentLogin={currentLogin}
                        members={vaultMembers}
                        pending={createComment.isPending}
                        replyToAuthor={replyTarget.author}
                        onCancel={() => setReplyTargetId(null)}
                        onSubmit={(body) =>
                          handleCreate(body, entry.comment.id)
                        }
                        onUploadFiles={handleUploadFiles}
                      />
                    ) : null}
                    {entry.replies.map((reply) => (
                      <div
                        key={reply.id}
                        data-testid="comment-reply"
                        className="flex min-w-0 flex-col gap-2"
                      >
                        <CommentCard
                          comment={reply}
                          currentLogin={currentLogin}
                          members={vaultMembers}
                          flash={reply.id === flashId}
                          replyToAuthor={
                            authorById.get(reply.parent_comment_id ?? "") ??
                            undefined
                          }
                          onSave={(body) => handleEdit(reply.id, body)}
                          onDelete={() => handleDelete(reply.id)}
                          onReply={() => setReplyTargetId(reply.id)}
                          resolveMarkdownUrl={resolveMarkdownUrl}
                          knownIssueIds={knownIssueIds}
                          vault={vault}
                        />
                        {replyTarget?.id === reply.id ? (
                          <CommentComposer
                            currentLogin={currentLogin}
                            members={vaultMembers}
                            pending={createComment.isPending}
                            replyToAuthor={reply.author}
                            onCancel={() => setReplyTargetId(null)}
                            onSubmit={(body) => handleCreate(body, reply.id)}
                            onUploadFiles={handleUploadFiles}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
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
          members={vaultMembers}
          pending={createComment.isPending}
          onSubmit={handleCreate}
          onUploadFiles={handleUploadFiles}
        />
      </div>

      {/* Persistent polite live region (implicit role="status") so a load
          failure that appears after mount is announced to screen readers, not
          just rendered silently. `empty:hidden` keeps it out of the layout
          until there is something to say. */}
      <output
        aria-live="polite"
        className="text-xs text-destructive empty:hidden"
      >
        {commentsError || activityError || bodyHistoryError
          ? ta("loadError")
          : null}
      </output>
    </section>
  );
}
