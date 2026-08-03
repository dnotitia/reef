"use client";

import { PersonAvatar } from "@/components/fields/PersonAvatar";
import { Button } from "@/components/ui/button";
import {
  type AttachmentMarkdownUploadResult,
  appendMarkdownSnippets,
  filesFromFileList,
} from "@/features/issues/lib/attachmentMarkdown";
import { type VaultMember, formatMentionToken } from "@reef/core";
import { CornerDownLeftIcon, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

interface MentionContext {
  start: number;
  query: string;
}

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const SAFE_QUERY = /^[\p{L}\p{N}]*$/u;

function previousCodePoint(value: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const previousIndex = index - 1;
  const codePoint = value.codePointAt(previousIndex);
  if (codePoint === undefined) return undefined;
  const start = previousIndex - (codePoint > 0xffff ? 1 : 0);
  return value.slice(start, index);
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function mentionContextAt(value: string, caret: number): MentionContext | null {
  const beforeCaret = value.slice(0, caret);
  const start = beforeCaret.lastIndexOf("@");
  if (start < 0 || isEscaped(beforeCaret, start)) return null;
  const previous = previousCodePoint(beforeCaret, start);
  if (previous === "@" || LETTER_OR_NUMBER.test(previous ?? "")) return null;

  const fragment = beforeCaret.slice(start + 1);
  if (fragment.includes("\n") || fragment.includes("\r")) return null;
  if (fragment.startsWith("{")) {
    if (fragment.includes("}")) return null;
    return { start, query: fragment.slice(1) };
  }
  if (!SAFE_QUERY.test(fragment)) return null;
  return { start, query: fragment };
}

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
 * editor, keeping the issue-detail surface light (the heavy editor is reserved
 * for the issue body). `⌘↵` / `Ctrl+↵` submits; plain Enter is a newline.
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionListboxId = useId();
  const [value, setValue] = useState("");
  const [mentionContext, setMentionContext] = useState<MentionContext | null>(
    null,
  );
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [composing, setComposing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const trimmed = value.trim();
  const t = useTranslations("issues.comments");
  const c = useTranslations("common");

  const mentionSuggestions = useMemo(() => {
    if (!mentionContext || composing) return [];
    const query = mentionContext.query.trim().toLocaleLowerCase();
    const filtered = members.filter((member) => {
      if (!query) return true;
      return (
        member.username.toLocaleLowerCase().includes(query) ||
        (member.display_name?.toLocaleLowerCase().includes(query) ?? false)
      );
    });
    return filtered.slice(0, 8);
  }, [composing, mentionContext, members]);
  const mentionOpen = mentionSuggestions.length > 0 && !composing;

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
    const caret = textarea?.selectionStart ?? value.length;
    const token = formatMentionToken(member.username);
    const nextValue = `${value.slice(0, mentionContext?.start ?? caret)}${token} ${value.slice(caret)}`;
    const nextCaret = (mentionContext?.start ?? caret) + token.length + 1;
    setValue(nextValue);
    setMentionContext(null);
    setSelectedMentionIndex(0);
    if (textarea) {
      textarea.focus();
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
        setMentionContext(null);
        return;
      }
      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        const selected = mentionSuggestions[selectedMentionIndex];
        if (selected) selectMention(selected);
        return;
      }
    }
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
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value;
            setValue(nextValue);
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
            syncMentionContext(
              event.currentTarget.value,
              event.currentTarget.selectionStart ??
                event.currentTarget.value.length,
            );
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
          rows={2}
          name={replyToAuthor ? "comment-reply" : "comment"}
          autoComplete="off"
          disabled={pending || uploading}
          aria-label={
            replyToAuthor
              ? t("replyLabel", { author: replyToAuthor })
              : t("addLabel")
          }
          aria-autocomplete="list"
          aria-controls={mentionOpen ? mentionListboxId : undefined}
          aria-expanded={mentionOpen}
          aria-activedescendant={
            mentionOpen
              ? `${mentionListboxId}-${selectedMentionIndex}`
              : undefined
          }
          placeholder={replyToAuthor ? t("replyPlaceholder") : t("placeholder")}
          className="max-h-60 w-full resize-none bg-transparent px-3 py-2 text-[13px] text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:opacity-50"
        />
        {mentionOpen ? (
          <div
            id={mentionListboxId}
            tabIndex={-1}
            // biome-ignore lint/a11y/useSemanticElements: this is a keyboard-owned autocomplete list, not a native select control.
            role="listbox"
            aria-label={t("mentionSuggestions")}
            className="mx-2 mb-2 overflow-hidden rounded-md border border-border bg-background shadow-sm"
          >
            {mentionSuggestions.map((member, index) => (
              <button
                key={member.username}
                id={`${mentionListboxId}-${index}`}
                type="button"
                tabIndex={-1}
                // biome-ignore lint/a11y/useSemanticElements: autocomplete options are actionable buttons while focus remains on the textarea.
                role="option"
                aria-selected={index === selectedMentionIndex}
                aria-label={t("mentionOption", {
                  username: formatMentionToken(member.username),
                })}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted aria-selected:bg-muted"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMention(member)}
              >
                <PersonAvatar
                  identityKey={member.username}
                  name={member.display_name ?? member.username}
                  size="xs"
                  decorative
                />
                <span className="min-w-0 truncate" translate="no">
                  {member.display_name ?? member.username}
                </span>
                <span
                  className="ml-auto shrink-0 text-[11px] text-muted-foreground"
                  translate="no"
                >
                  {formatMentionToken(member.username)}
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
