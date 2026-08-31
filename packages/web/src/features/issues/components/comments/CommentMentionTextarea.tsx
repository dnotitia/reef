"use client";

import { PersonAvatar, personToneFor } from "@/components/fields/PersonAvatar";
import { useOverlayOpenRegistration } from "@/components/ui/overlayDismiss";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import {
  type AttachmentMarkdownUploadResult,
  appendMarkdownSnippets,
  filesFromFileList,
} from "@/features/issues/lib/attachmentMarkdown";
import type { VaultMember } from "@reef/core";
import { useTranslations } from "next-intl";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  type CommentMentionDraft,
  commentMentionSuggestions,
  mentionContextAt,
  selectCommentMention,
  updateCommentMentionDraft,
} from "./commentMentionDraft";

interface CommentMentionTextareaProps {
  draft: CommentMentionDraft;
  members: readonly VaultMember[];
  pending: boolean;
  name: string;
  ariaLabel: string;
  placeholder: string;
  rows: number;
  className: string;
  autoFocus?: boolean;
  onDraftChange: (draft: CommentMentionDraft) => void;
  onSubmit?: () => void;
  onEscape?: () => void;
  onUploadFiles?: (files: File[]) => Promise<AttachmentMarkdownUploadResult[]>;
  onUploadingChange?: (uploading: boolean) => void;
}

/**
 * Shared comment/reply/edit textarea. The textarea owns user-visible
 * interaction; canonical mention syntax is introduced by the save boundary in
 * the parent through serializeCommentMentionDraft.
 */
export function CommentMentionTextarea({
  draft,
  members,
  pending,
  name,
  ariaLabel,
  placeholder,
  rows,
  className,
  autoFocus = false,
  onDraftChange,
  onSubmit,
  onEscape,
  onUploadFiles,
  onUploadingChange,
}: CommentMentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const dismissedMentionSelectionRef = useRef<{
    value: string;
    start: number;
  } | null>(null);
  const mentionListboxId = useId();
  const [mentionContext, setMentionContext] =
    useState<ReturnType<typeof mentionContextAt>>(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [composing, setComposing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const t = useTranslations("issues.comments");
  const currentLogin = useCurrentUserLogin();

  const mentionSuggestions = composing
    ? []
    : commentMentionSuggestions(members, mentionContext);
  const mentionOpen = mentionSuggestions.length > 0 && !composing;
  useOverlayOpenRegistration(mentionOpen);

  function syncMentionContext(nextValue: string, caret: number) {
    if (composing) {
      setMentionContext(null);
      return;
    }
    setMentionContext(mentionContextAt(nextValue, caret));
    setSelectedMentionIndex(0);
  }

  function selectMention(member: VaultMember) {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? draft.text.length;
    const start = mentionContext?.start ?? caret;
    const nextDraft = selectCommentMention(
      draftRef.current,
      member,
      start,
      caret,
    );
    draftRef.current = nextDraft;
    onDraftChange(nextDraft);
    setMentionContext(null);
    setSelectedMentionIndex(0);
    if (textarea) {
      textarea.focus();
      const nextCaret = start + member.username.length + 2;
      const restoreSelection = () =>
        textarea.setSelectionRange(nextCaret, nextCaret);
      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        window.requestAnimationFrame(restoreSelection);
      } else {
        restoreSelection();
      }
    }
  }

  async function uploadAndAppend(files: File[]) {
    if (!onUploadFiles || pending) return;
    setUploading(true);
    onUploadingChange?.(true);
    setUploadError(false);
    try {
      const results = await onUploadFiles(files);
      const snippets = results
        .map((result) => result.markdown)
        .filter((markdown): markdown is string => !!markdown);
      const nextDraft = updateCommentMentionDraft(
        draftRef.current,
        appendMarkdownSnippets(draftRef.current.text, snippets),
      );
      draftRef.current = nextDraft;
      onDraftChange(nextDraft);
    } catch {
      setUploadError(true);
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
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

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedMentionIndex(
          (index) => (index + 1) % mentionSuggestions.length,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedMentionIndex(
          (index) =>
            (index - 1 + mentionSuggestions.length) % mentionSuggestions.length,
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissedMentionSelectionRef.current = {
          value: draftRef.current.text,
          start:
            textareaRef.current?.selectionStart ?? draftRef.current.text.length,
        };
        setMentionContext(null);
        setSelectedMentionIndex(0);
        return;
      }
      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        const selected = mentionSuggestions[selectedMentionIndex];
        if (selected) selectMention(selected);
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape?.();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit?.();
    }
  }

  return (
    <>
      <textarea
        ref={textareaRef}
        value={draft.text}
        onChange={(event) => {
          const nextValue = event.target.value;
          const nextDraft = updateCommentMentionDraft(
            draftRef.current,
            nextValue,
          );
          dismissedMentionSelectionRef.current = null;
          draftRef.current = nextDraft;
          onDraftChange(nextDraft);
          const isComposingEvent = (
            event.nativeEvent as Event & { isComposing?: boolean }
          ).isComposing;
          if (isComposingEvent) {
            setMentionContext(null);
          } else {
            syncMentionContext(
              nextValue,
              event.currentTarget.selectionStart ?? nextValue.length,
            );
          }
        }}
        onKeyDown={onKeyDown}
        onSelect={(event) => {
          const nextValue = event.currentTarget.value;
          const nextStart =
            event.currentTarget.selectionStart ?? nextValue.length;
          const dismissedSelection = dismissedMentionSelectionRef.current;
          if (
            dismissedSelection?.value === nextValue &&
            dismissedSelection.start === nextStart
          ) {
            dismissedMentionSelectionRef.current = null;
            return;
          }
          dismissedMentionSelectionRef.current = null;
          syncMentionContext(nextValue, nextStart);
        }}
        onCompositionStart={() => {
          setComposing(true);
          setMentionContext(null);
        }}
        onCompositionEnd={(event) => {
          setComposing(false);
          setMentionContext(
            mentionContextAt(
              event.currentTarget.value,
              event.currentTarget.selectionStart ??
                event.currentTarget.value.length,
            ),
          );
          setSelectedMentionIndex(0);
        }}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(event) => {
          if (onUploadFiles && !pending) event.preventDefault();
        }}
        rows={rows}
        name={name}
        autoComplete="off"
        disabled={pending || uploading}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={mentionOpen ? mentionListboxId : undefined}
        aria-expanded={mentionOpen}
        aria-activedescendant={
          mentionOpen
            ? `${mentionListboxId}-${selectedMentionIndex}`
            : undefined
        }
        placeholder={placeholder}
        // biome-ignore lint/a11y/noAutofocus: edit mode intentionally focuses the draft.
        autoFocus={autoFocus}
        className={className}
      />
      {mentionOpen ? (
        <div
          id={mentionListboxId}
          tabIndex={-1}
          role="listbox"
          aria-label={t("mentionSuggestions")}
          className="mx-2 mb-2 overflow-hidden rounded-md border border-border bg-surface-page shadow-sm"
        >
          {mentionSuggestions.map((member, index) => (
            <button
              key={member.username}
              id={`${mentionListboxId}-${index}`}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={index === selectedMentionIndex}
              aria-label={t("mentionOption", {
                username: `@${member.username}`,
              })}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted aria-selected:bg-muted"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectMention(member)}
            >
              <PersonAvatar
                identityKey={member.username}
                name={member.display_name ?? member.username}
                size="xs"
                tone={personToneFor(member.username, currentLogin)}
                decorative
              />
              <span className="min-w-0 truncate" translate="no">
                {member.display_name ?? member.username}
              </span>
              <span
                className="ml-auto shrink-0 text-[11px] text-muted-foreground"
                translate="no"
              >
                @{member.username}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {(uploading || uploadError) && (
        <div
          className="px-3 pb-1 text-[11px] text-muted-foreground"
          role={uploadError ? "alert" : "status"}
        >
          {uploadError ? t("uploadError") : t("uploading")}
        </div>
      )}
    </>
  );
}
