"use client";

import { PersonAvatar } from "@/components/fields/PersonAvatar";
import { Button } from "@/components/ui/button";
import type { AttachmentMarkdownUploadResult } from "@/features/issues/lib/attachmentMarkdown";
import type { VaultMember } from "@reef/core";
import { CornerDownLeftIcon, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CommentMentionTextarea } from "./CommentMentionTextarea";
import {
  type CommentMentionDraft,
  emptyCommentMentionDraft,
  serializeCommentMentionDraft,
} from "./commentMentionDraft";

interface CommentComposerProps {
  /** Current user login — tones the composer avatar teal ("this is you"). */
  currentLogin: string | null;
  /** Exact-case current vault roster used by the mention autocomplete. */
  members?: readonly VaultMember[];
  pending: boolean;
  /** Resolve to clear the field; reject to keep the typed text for a retry. */
  onSubmit: (body: string) => Promise<void>;
  onUploadFiles?: (files: File[]) => Promise<AttachmentMarkdownUploadResult[]>;
  replyToAuthor?: string;
  onCancel?: () => void;
}

/**
 * The comment composer (REEF-062): a framed, avatar-gutter input. Plain
 * markdown text in an auto-growing textarea — comments does not mount the TipTap
 * editor, keeping the issue-detail surface light. Mention identity is kept
 * alongside the visible draft and serialized only when this form is submitted.
 */
export function CommentComposer({
  currentLogin,
  members = [],
  pending,
  onSubmit,
  onUploadFiles,
  replyToAuthor,
  onCancel,
}: CommentComposerProps) {
  const [draft, setDraft] = useState<CommentMentionDraft>(() =>
    emptyCommentMentionDraft(),
  );
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const trimmed = draft.text.trim();
  const t = useTranslations("issues.comments");
  const c = useTranslations("common");

  async function submit() {
    const body = serializeCommentMentionDraft(draft).trim();
    if (!body || pending || uploading) return;
    try {
      await onSubmit(body);
      setDraft(emptyCommentMentionDraft());
      setSubmitError(false);
    } catch {
      setSubmitError(true);
      // Keep the visible draft so the author can retry.
    }
  }

  return (
    <form
      className="flex gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <PersonAvatar
        identityKey={currentLogin}
        size="sm"
        tone="brand"
        decorative
        className="mt-1 shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col rounded-md border border-border bg-elevated transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand/30">
        {replyToAuthor ? (
          <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border-subtle px-3 py-1.5">
            <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
              {t.rich("replyingTo", {
                author: replyToAuthor,
                target: (chunks) => <span translate="no">{chunks}</span>,
              })}
            </span>
            {onCancel ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={onCancel}
                disabled={pending}
              >
                {c("cancel")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <CommentMentionTextarea
          draft={draft}
          members={members}
          pending={pending}
          name={replyToAuthor ? "comment-reply" : "comment"}
          ariaLabel={
            replyToAuthor
              ? t("replyLabel", { author: replyToAuthor })
              : t("addLabel")
          }
          placeholder={replyToAuthor ? t("replyPlaceholder") : t("placeholder")}
          rows={2}
          className="max-h-60 w-full resize-none bg-transparent px-3 py-2 text-[13px] text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:opacity-50"
          onDraftChange={setDraft}
          onSubmit={() => void submit()}
          onUploadFiles={onUploadFiles}
          onUploadingChange={setUploading}
        />
        {submitError ? (
          <div className="px-3 pb-1 text-[11px] text-destructive" role="alert">
            {t("submitError")}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2 px-2 pb-2">
          <span
            className="text-[11px] text-muted-foreground"
            aria-hidden="true"
          >
            ⌘↵
          </span>
          <Button
            type="submit"
            variant="brand"
            size="sm"
            disabled={pending || uploading || !trimmed}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <CornerDownLeftIcon className="size-3.5" aria-hidden="true" />
            )}
            {replyToAuthor ? t("submitReply") : t("submit")}
          </Button>
        </div>
      </div>
    </form>
  );
}
