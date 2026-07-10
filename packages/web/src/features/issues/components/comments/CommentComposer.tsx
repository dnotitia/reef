"use client";

import { PersonAvatar } from "@/components/fields/PersonAvatar";
import { Button } from "@/components/ui/button";
import {
  type AttachmentMarkdownUploadResult,
  appendMarkdownSnippets,
  filesFromFileList,
} from "@/features/issues/lib/attachmentMarkdown";
import { CornerDownLeftIcon, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useState,
} from "react";

interface CommentComposerProps {
  /** Current user login — tones the composer avatar teal ("this is you"). */
  currentLogin: string | null;
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
 * editor, keeping the issue-detail surface light (the heavy editor is reserved
 * for the issue body). `⌘↵` / `Ctrl+↵` submits; plain Enter is a newline.
 */
export function CommentComposer({
  currentLogin,
  pending,
  onSubmit,
  onUploadFiles,
  replyToAuthor,
  onCancel,
}: CommentComposerProps) {
  const [value, setValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const trimmed = value.trim();
  const t = useTranslations("issues.comments");
  const c = useTranslations("common");

  async function submit() {
    if (!trimmed || pending) return;
    try {
      await onSubmit(trimmed);
      setValue("");
      setSubmitError(false);
    } catch {
      setSubmitError(true);
      // Keep the typed text so the author can retry; the error is surfaced as a
      // toast by the parent.
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  }

  async function uploadAndAppend(files: File[]) {
    if (!onUploadFiles || pending) return;
    setUploading(true);
    setUploadError(false);
    try {
      const results = await onUploadFiles(files);
      const snippets = results
        .map((result) => result.markdown)
        .filter((markdown): markdown is string => !!markdown);
      setValue((current) => appendMarkdownSnippets(current, snippets));
    } catch {
      setUploadError(true);
    } finally {
      setUploading(false);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = filesFromFileList(event.clipboardData.files);
    if (files.length === 0 || !onUploadFiles || pending) return;
    event.preventDefault();
    void uploadAndAppend(files);
  }

  function handleDrop(event: DragEvent<HTMLTextAreaElement>) {
    const files = filesFromFileList(event.dataTransfer.files);
    if (files.length === 0 || !onUploadFiles || pending) return;
    event.preventDefault();
    void uploadAndAppend(files);
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
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={(event) => {
            if (onUploadFiles && !pending) event.preventDefault();
          }}
          rows={2}
          name={replyToAuthor ? "comment-reply" : "comment"}
          autoComplete="off"
          disabled={pending || uploading}
          aria-label={
            replyToAuthor
              ? t("replyLabel", { author: replyToAuthor })
              : t("addLabel")
          }
          placeholder={replyToAuthor ? t("replyPlaceholder") : t("placeholder")}
          className="max-h-60 w-full resize-none bg-transparent px-3 py-2 text-[13px] text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:opacity-50"
        />
        {(uploading || uploadError) && (
          <div
            className="px-3 pb-1 text-[11px] text-muted-foreground"
            role={uploadError ? "alert" : "status"}
          >
            {uploadError ? t("uploadError") : t("uploading")}
          </div>
        )}
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
