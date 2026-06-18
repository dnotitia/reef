"use client";

import { PersonAvatar } from "@/components/fields/PersonAvatar";
import { Button } from "@/components/ui/button";
import { CornerDownLeftIcon, Loader2 } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

interface CommentComposerProps {
  /** Current user login — tones the composer avatar teal ("this is you"). */
  currentLogin: string | null;
  pending: boolean;
  /** Resolve to clear the field; reject to keep the typed text for a retry. */
  onSubmit: (body: string) => Promise<void>;
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
}: CommentComposerProps) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  async function submit() {
    if (!trimmed || pending) return;
    try {
      await onSubmit(trimmed);
      setValue("");
    } catch {
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
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          disabled={pending}
          aria-label="Add a comment"
          placeholder="Add a comment…"
          className="max-h-60 w-full resize-none bg-transparent px-3 py-2 text-[13px] text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:opacity-50"
        />
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
            disabled={pending || !trimmed}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <CornerDownLeftIcon className="size-3.5" aria-hidden="true" />
            )}
            Comment
          </Button>
        </div>
      </div>
    </form>
  );
}
