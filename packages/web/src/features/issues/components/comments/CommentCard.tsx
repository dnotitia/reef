"use client";

import { PersonAvatar, personToneFor } from "@/components/fields/PersonAvatar";
import { linkSafetyConfig } from "@/components/markdown/linkSafety";
import { Button } from "@/components/ui/button";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";
import type { Comment } from "@reef/core";
import { Pencil } from "lucide-react";
import { useLocale } from "next-intl";
import { type KeyboardEvent, useState } from "react";
import { Streamdown } from "streamdown";

interface CommentCardProps {
  comment: Comment;
  /** Current user login — the author's own comments get the edit affordance. */
  currentLogin: string | null;
  /** One-shot save flash on a just-posted comment. */
  flash?: boolean;
  /** Resolve to leave edit mode; reject to stay editing (error toasted above). */
  onSave: (body: string) => Promise<void>;
}

/**
 * One comment in the thread (REEF-062): an avatar node in the gutter, a header
 * line (author · relative time · "edited"), and the markdown body rendered
 * read-mode via Streamdown (no per-comment TipTap). Hover/focus reveals the
 * edit affordance, and for the author's own comments.
 */
export function CommentCard({
  comment,
  currentLogin,
  flash = false,
  onSave,
}: CommentCardProps) {
  const isOwn = !!currentLogin && comment.author === currentLogin;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const locale = useLocale();

  function startEditing() {
    setDraft(comment.body);
    setEditing(true);
  }

  async function save() {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    try {
      await onSave(body);
      setEditing(false);
    } catch {
      // Stay in edit mode; the parent surfaces the error as a toast.
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditing(false);
    }
  }

  return (
    <div className={cn("group flex gap-3", flash && "reef-flash-row")}>
      <PersonAvatar
        identityKey={comment.author}
        name={comment.author}
        size="sm"
        tone={personToneFor(comment.author, currentLogin)}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-xs font-medium text-foreground"
            translate="no"
          >
            {comment.author}
          </span>
          <time
            dateTime={comment.created_at}
            title={formatAbsoluteTime(comment.created_at, locale)}
            className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
          >
            {formatRelativeTime(comment.created_at, nowMs, locale)}
          </time>
          {comment.edited_at ? (
            <span
              title={formatAbsoluteTime(comment.edited_at, locale)}
              className="shrink-0 text-[11px] text-muted-foreground"
            >
              · edited
            </span>
          ) : null}
          {isOwn && !editing ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Edit comment"
              onClick={startEditing}
              className="ml-auto text-muted-foreground opacity-0 motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-[var(--ease-signature)] hover:text-foreground focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        {editing ? (
          <div className="mt-1 flex flex-col rounded-md border border-brand bg-elevated ring-2 ring-inset ring-brand/30">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              disabled={saving}
              aria-label="Comment draft"
              // biome-ignore lint/a11y/noAutofocus: focusing the field is the point of entering edit mode.
              autoFocus
              className="max-h-60 w-full resize-none bg-transparent px-3 py-2 text-[13px] text-foreground outline-none [field-sizing:content] disabled:opacity-50"
            />
            <div className="flex items-center justify-end gap-2 px-2 pb-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="brand"
                size="sm"
                onClick={() => void save()}
                disabled={saving || !draft.trim()}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <Streamdown
            className="mt-1 w-full min-w-0 break-words text-[13px] text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            linkSafety={linkSafetyConfig}
          >
            {comment.body}
          </Streamdown>
        )}
      </div>
    </div>
  );
}
