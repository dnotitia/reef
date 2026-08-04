"use client";

import { PersonAvatar, personToneFor } from "@/components/fields/PersonAvatar";
import { linkSafetyConfig } from "@/components/markdown/linkSafety";
import { Button } from "@/components/ui/button";
import { remarkCommentMentions } from "@/lib/markdown/remarkCommentMentions";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";
import type { Comment, VaultMember } from "@reef/core";
import { Pencil, Reply } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ComponentProps, useMemo, useState } from "react";
import {
  type AllowedTags,
  Streamdown,
  type UrlTransform,
  defaultUrlTransform,
} from "streamdown";
import { CommentMentionTextarea } from "./CommentMentionTextarea";
import {
  type CommentMentionDraft,
  draftFromPersistedComment,
  serializeCommentMentionDraft,
} from "./commentMentionDraft";

type RemarkPlugins = ComponentProps<typeof Streamdown>["remarkPlugins"];

const COMMENT_MENTION_ALLOWED_TAGS: AllowedTags = {
  span: ["dataReefMention"],
};

interface CommentCardProps {
  comment: Comment;
  /** Current user login — the author's own comments get the edit affordance. */
  currentLogin: string | null;
  /** One-shot save flash on a just-posted comment. */
  flash?: boolean;
  /** Resolve to leave edit mode; reject to stay editing (error toasted above). */
  onSave: (body: string) => Promise<void>;
  onReply?: () => void;
  replyToAuthor?: string;
  resolveMarkdownUrl?: UrlTransform;
  /** Current vault roster used by the edit-mode mention autocomplete. */
  members?: readonly VaultMember[];
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
  onReply,
  replyToAuthor,
  resolveMarkdownUrl,
  members = [],
}: CommentCardProps) {
  const isOwn = !!currentLogin && comment.author === currentLogin;
  const [editing, setEditing] = useState(false);
  const mentionUsernames = useMemo(
    () => new Set(comment.mention_recipients ?? []),
    [comment.mention_recipients],
  );
  const [draft, setDraft] = useState<CommentMentionDraft>(() =>
    draftFromPersistedComment(comment.body, mentionUsernames),
  );
  const [saving, setSaving] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const locale = useLocale();
  const t = useTranslations("issues.comments");
  const c = useTranslations("common");
  const mentionFingerprint = useMemo(
    () =>
      `${comment.id}:${comment.body}:${[...mentionUsernames].sort().join(",")}`,
    [comment.body, comment.id, mentionUsernames],
  );
  const remarkPlugins = useMemo<RemarkPlugins>(
    () => [
      [
        remarkCommentMentions,
        {
          knownUsernames: mentionUsernames,
          cacheFingerprint: mentionFingerprint,
        },
      ],
    ],
    [mentionFingerprint, mentionUsernames],
  );

  function startEditing() {
    setDraft(draftFromPersistedComment(comment.body, mentionUsernames));
    setEditing(true);
  }

  async function save() {
    const body = serializeCommentMentionDraft(draft).trim();
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

  const urlTransform: UrlTransform = (url, key, node) => {
    const resolved = resolveMarkdownUrl?.(url, key, node) ?? url;
    if (resolved !== url) return resolved;
    return defaultUrlTransform(url, key, node);
  };

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
              · {t("edited")}
            </span>
          ) : null}
          {!editing ? (
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {onReply ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onReply}
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground opacity-100 motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-[var(--ease-signature)] hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                >
                  <Reply className="size-3.5" aria-hidden="true" />
                  {t("reply")}
                </Button>
              ) : null}
              {isOwn ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("editComment")}
                  title={t("editComment")}
                  onClick={startEditing}
                  className="text-muted-foreground opacity-0 motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-[var(--ease-signature)] hover:text-foreground focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {replyToAuthor ? (
          <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
            {t.rich("replyingTo", {
              author: replyToAuthor,
              target: (chunks) => <span translate="no">{chunks}</span>,
            })}
          </p>
        ) : null}

        {editing ? (
          <div className="mt-1 flex flex-col rounded-md border border-brand bg-elevated ring-2 ring-inset ring-brand/30">
            <CommentMentionTextarea
              draft={draft}
              members={members}
              pending={saving}
              name="comment-edit"
              ariaLabel={t("draftLabel")}
              placeholder={t("placeholder")}
              rows={3}
              autoFocus
              onDraftChange={setDraft}
              onSubmit={() => void save()}
              onEscape={() => setEditing(false)}
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
                {c("cancel")}
              </Button>
              <Button
                type="button"
                variant="brand"
                size="sm"
                onClick={() => void save()}
                disabled={saving || !draft.text.trim()}
              >
                {c("save")}
              </Button>
            </div>
          </div>
        ) : (
          <Streamdown
            key={mentionFingerprint}
            className="comment-mention-renderer mt-1 w-full min-w-0 break-words text-[13px] text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            linkSafety={linkSafetyConfig}
            urlTransform={urlTransform}
            remarkPlugins={remarkPlugins}
            allowedTags={COMMENT_MENTION_ALLOWED_TAGS}
          >
            {comment.body}
          </Streamdown>
        )}
      </div>
    </div>
  );
}
