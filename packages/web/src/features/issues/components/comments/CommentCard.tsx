"use client";

import { PersonAvatar, personToneFor } from "@/components/fields/PersonAvatar";
import { linkSafetyConfig } from "@/components/markdown/linkSafety";
import { Button } from "@/components/ui/button";
import { StatusIcon } from "@/components/ui/status-icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { remarkCommentMentions } from "@/lib/markdown/remarkCommentMentions";
import { remarkReefMentions } from "@/lib/markdown/remarkReefMentions";
import { buildOpenIssueHref } from "@/features/issues/lib/issueHref";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";
import type { Comment, IssueListItem, VaultMember } from "@reef/core";
import { Pencil, Reply, Trash2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  type ComponentProps,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { commentTargetId } from "../../lib/commentTarget";

type RemarkPlugins = ComponentProps<typeof Streamdown>["remarkPlugins"];

const COMMENT_MENTION_ALLOWED_TAGS: AllowedTags = {
  span: ["dataReefMention", "dataReefStatusIcon"],
  a: ["href", "title", "dataReefId"],
};

interface CommentCardProps {
  comment: Comment;
  /** Current user login — the author's own comments get the edit affordance. */
  currentLogin: string | null;
  /** One-shot save flash on a just-posted comment. */
  flash?: boolean;
  /** Resolve to leave edit mode; reject to stay editing (error toasted above). */
  onSave: (body: string) => Promise<void>;
  /** Resolve after the server confirms hard deletion of this comment subtree. */
  onDelete?: () => Promise<void>;
  onReply?: () => void;
  replyToAuthor?: string;
  resolveMarkdownUrl?: UrlTransform;
  /** Current vault roster used by the edit-mode mention autocomplete. */
  members?: readonly VaultMember[];
  /** Whole-vault loaded issue list shared with the body editor. */
  allIssues?: readonly IssueListItem[];
  /** Active vault used for known issue detail links. */
  vault?: string;
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
  onDelete,
  onReply,
  replyToAuthor,
  resolveMarkdownUrl,
  members = [],
  allIssues = [],
  vault = "",
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
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const locale = useLocale();
  const t = useTranslations("issues.comments");
  const c = useTranslations("common");
  const mentionFingerprint = useMemo(
    () =>
      `${comment.id}:${comment.body}:${[...mentionUsernames].sort().join(",")}`,
    [comment.body, comment.id, mentionUsernames],
  );
  const knownIssues = useMemo(
    () => new Map(allIssues.map((issue) => [issue.id.toUpperCase(), issue])),
    [allIssues],
  );
  const issueReferenceFingerprint = useMemo(
    () =>
      `${vault}:${[...knownIssues.values()]
        .map((issue) => `${issue.id}:${issue.status}:${issue.title}`)
        .sort()
        .join(",")}`,
    [knownIssues, vault],
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
      [
        remarkReefMentions,
        {
          isKnown: (id: string) => knownIssues.has(id.toUpperCase()),
          hrefFor: (id: string) =>
            buildOpenIssueHref(vault, id.toUpperCase(), new URLSearchParams()),
          cacheFingerprint: issueReferenceFingerprint,
        },
      ],
    ],
    [
      issueReferenceFingerprint,
      knownIssues,
      mentionFingerprint,
      mentionUsernames,
      vault,
    ],
  );

  function startEditing() {
    const nextDraft = draftFromPersistedComment(comment.body, mentionUsernames);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setEditing(true);
  }

  function handleDraftChange(nextDraft: CommentMentionDraft) {
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  async function save() {
    const body = serializeCommentMentionDraft(draftRef.current).trim();
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

  async function confirmDelete() {
    if (!onDelete || deleting) return;
    setDeleting(true);
    try {
      await onDelete();
      setDeleteOpen(false);
    } catch {
      // Keep the comment and confirmation open so the user can retry.
    } finally {
      setDeleting(false);
    }
  }

  const urlTransform: UrlTransform = (url, key, node) => {
    const resolved = resolveMarkdownUrl?.(url, key, node) ?? url;
    if (resolved !== url) return resolved;
    return defaultUrlTransform(url, key, node);
  };

  function SafeExternalAnchor({
    href,
    children,
    ...props
  }: ComponentProps<"a"> & { href?: string }) {
    const [open, setOpen] = useState(false);
    if (!href || !linkSafetyConfig.enabled) {
      return (
        <a href={href} target="_blank" rel="noreferrer" {...props}>
          {children}
        </a>
      );
    }
    return (
      <>
        <button
          type="button"
          className="wrap-anywhere font-medium text-brand underline hover:text-brand/80"
          onClick={() => setOpen(true)}
        >
          {children}
        </button>
        {linkSafetyConfig.renderModal?.({
          url: href,
          isOpen: open,
          onClose: () => setOpen(false),
          onConfirm: () => window.open(href, "_blank", "noopener,noreferrer"),
        })}
      </>
    );
  }

  function CommentMarkdownAnchor({
    href,
    node,
    children,
    ...props
  }: ComponentProps<"a"> & { node?: unknown }) {
    const properties =
      node && typeof node === "object" && "properties" in node
        ? (node as { properties?: Record<string, unknown> }).properties
        : undefined;
    const rawId = properties?.dataReefId ?? properties?.["data-reef-id"];
    const id = typeof rawId === "string" ? rawId.toUpperCase() : "";
    const issue = knownIssues.get(id);
    if (issue && vault) {
      return (
        <Link
          href={buildOpenIssueHref(vault, id, new URLSearchParams())}
          data-reef-issue-id={id}
          translate="no"
          className="inline-flex max-w-full items-center gap-1 rounded-sm px-0.5 align-baseline text-foreground underline decoration-brand/50 decoration-1 underline-offset-2 transition-colors hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          {...props}
        >
          <StatusIcon status={issue.status} size={13} decorative />
          <span className="shrink-0 font-mono text-[12px]" translate="no">
            {id}
          </span>
          <span className="truncate" translate="yes">
            {issue.title}
          </span>
        </Link>
      );
    }
    return (
      <SafeExternalAnchor href={href} {...props}>
        {children}
      </SafeExternalAnchor>
    );
  }

  return (
    <div
      id={commentTargetId(comment.id) ?? undefined}
      data-testid="comment-card"
      tabIndex={-1}
      className={cn("group flex scroll-mt-4 gap-3", flash && "reef-flash-row")}
    >
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
              {isOwn && onDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("deleteComment")}
                  title={t("deleteComment")}
                  onClick={() => setDeleteOpen(true)}
                  className="text-muted-foreground opacity-0 motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-[var(--ease-signature)] hover:text-destructive focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
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
              onDraftChange={handleDraftChange}
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
            key={`${mentionFingerprint}:${issueReferenceFingerprint}`}
            className="comment-mention-renderer mt-1 w-full min-w-0 break-words text-[13px] text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            // Custom anchors own both in-app issue routing and the external
            // confirmation dialog; disable Streamdown's default wrapper so it
            // does not intercept the marker before the renderer can inspect it.
            linkSafety={{ enabled: false }}
            urlTransform={urlTransform}
            remarkPlugins={remarkPlugins}
            allowedTags={COMMENT_MENTION_ALLOWED_TAGS}
            components={{ a: CommentMarkdownAnchor }}
          >
            {comment.body}
          </Streamdown>
        )}
      </div>

      {isOwn && onDelete ? (
        <Dialog
          open={deleteOpen}
          onOpenChange={(open) => {
            if (!deleting) setDeleteOpen(open);
          }}
        >
          <DialogContent
            data-testid="comment-delete-confirm"
            className="max-w-md gap-4"
            onInteractOutside={(event) => {
              if (deleting) event.preventDefault();
            }}
            onEscapeKeyDown={(event) => {
              if (deleting) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("deleteTitle")}</DialogTitle>
              <DialogDescription>{t("deleteDescription")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                data-testid="comment-delete-cancel"
              >
                {c("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                data-testid="comment-delete-confirm-btn"
              >
                {deleting ? t("deleting") : c("delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
