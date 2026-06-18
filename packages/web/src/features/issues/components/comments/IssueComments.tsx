"use client";

import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { useCreateComment } from "@/features/issues/hooks/mutations/useCreateComment";
import { useUpdateComment } from "@/features/issues/hooks/mutations/useUpdateComment";
import { useComments } from "@/features/issues/hooks/queries/useComments";
import { useState } from "react";
import { toast } from "sonner";
import { ISSUE_SECTION_HEADER_CLASS } from "../shared/IssueFormSection";
import { CommentCard } from "./CommentCard";
import { CommentComposer } from "./CommentComposer";

interface IssueCommentsProps {
  issueId: string;
  vault: string;
}

/**
 * The issue detail's "Comments" section (REEF-062). Like Linked documents, it
 * owns its own data + mutations rather than being a controlled child. Comments
 * render as a borderless avatar-gutter stream; the composer is the only framed
 * surface. Mounted at the bottom of the main column — the conversation grows
 * after the structured fields (and is where REEF-064 will fold in activity).
 */
export function IssueComments({ issueId, vault }: IssueCommentsProps) {
  const currentLogin = useCurrentUserLogin();
  const { data: comments = [], isError } = useComments(issueId, vault);
  const createComment = useCreateComment();
  const updateComment = useUpdateComment();
  const [flashId, setFlashId] = useState<string | null>(null);

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
      <h3 className={ISSUE_SECTION_HEADER_CLASS}>Comments</h3>

      {comments.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-5">
          {comments.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              currentLogin={currentLogin}
              flash={comment.id === flashId}
              onSave={(body) => handleEdit(comment.id, body)}
            />
          ))}
        </div>
      ) : null}

      <CommentComposer
        currentLogin={currentLogin}
        pending={createComment.isPending}
        onSubmit={handleCreate}
      />

      {isError ? (
        <p className="text-xs text-destructive">
          Couldn't load comments. Try again.
        </p>
      ) : null}
    </section>
  );
}
