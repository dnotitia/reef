"use client";

import { PersonAvatar, personToneFor } from "@/components/fields/PersonAvatar";
import { linkSafetyConfig } from "@/components/markdown/linkSafety";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { remarkCommentMentions } from "@/lib/markdown/remarkCommentMentions";
import { parseAkbDocumentUri } from "@/lib/akb/documentUri";
import {
  attachmentFileTypeLabel,
  isAkbFileUri,
} from "@/features/issues/lib/attachmentUrls";
import {
  isDirectIssueMarkdownHref,
  issueIdFromIssueMarkdownHref,
} from "@/features/issues/lib/markdownLinkPolicy";
import { remarkReefMentions } from "@/lib/markdown/remarkReefMentions";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import type { Comment, VaultMember } from "@reef/core";
import { Pencil, Reply, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  type ComponentProps,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  defaultRemarkPlugins,
  defaultRehypePlugins,
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
type RehypePlugins = ComponentProps<typeof Streamdown>["rehypePlugins"];

interface SanitizerSchema {
  attributes?: Record<string, readonly unknown[]>;
  protocols?: Record<string, readonly string[]>;
}

const issueMarkdownRehypePlugins = (() => {
  const [sanitize, schema] = defaultRehypePlugins.sanitize as unknown as [
    NonNullable<RehypePlugins>[number],
    SanitizerSchema,
  ];

  return [
    defaultRehypePlugins.raw,
    [
      sanitize,
      {
        ...schema,
        attributes: {
          ...schema.attributes,
          span: [...(schema.attributes?.span ?? []), "dataReefMention"],
        },
        protocols: {
          ...schema.protocols,
          href: [...(schema.protocols?.href ?? []), "akb"],
        },
      },
    ],
    defaultRehypePlugins.harden,
  ] as NonNullable<RehypePlugins>;
})();

function isAttachmentProxyHref(href: string): boolean {
  return href.startsWith("/api/issues/") && href.includes("/attachments/file?");
}

function attachmentUriFromProxyHref(href: string): string | null {
  if (!isAttachmentProxyHref(href)) return null;
  try {
    return new URL(href, "https://reef.invalid").searchParams.get("uri");
  } catch {
    return null;
  }
}

function CommentMarkdownLink({
  children,
  href,
  "data-reef-id": reefIssueId,
  ...rest
}: ComponentProps<"a"> & { node?: unknown; "data-reef-id"?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const safeHref = typeof href === "string" ? href : "";
  const isInternal = safeHref ? isDirectIssueMarkdownHref(safeHref) : true;
  const shouldConfirm =
    Boolean(safeHref) && !isInternal && linkSafetyConfig.enabled;
  const fileUri = attachmentUriFromProxyHref(safeHref);
  const issueReferenceId =
    reefIssueId ?? issueIdFromIssueMarkdownHref(safeHref);
  const isIssueReference = Boolean(issueReferenceId);
  const onClose = () => setIsOpen(false);
  const onConfirm = () => {
    window.open(safeHref, "_blank", "noreferrer");
  };

  return (
    <>
      <a
        {...rest}
        href={href}
        target={
          shouldConfirm || fileUri || isIssueReference ? "_blank" : rest.target
        }
        rel={
          shouldConfirm || fileUri || isIssueReference ? "noreferrer" : rest.rel
        }
        translate={isIssueReference ? "no" : rest.translate}
        data-reef-id={issueReferenceId ?? undefined}
        data-reference-kind={
          fileUri
            ? "file"
            : isIssueReference
              ? "issue"
              : parseAkbDocumentUri(safeHref)
                ? "document"
                : undefined
        }
        data-issue-id={issueReferenceId ?? undefined}
        data-reef-file-link={fileUri ? "true" : undefined}
        data-reef-file-uri={fileUri ?? undefined}
        data-document-uri={parseAkbDocumentUri(safeHref) ? safeHref : undefined}
        data-reef-file-type={
          fileUri && typeof children === "string"
            ? attachmentFileTypeLabel(children)
            : undefined
        }
        onClick={(event) => {
          if (!shouldConfirm) return;
          event.preventDefault();
          setIsOpen(true);
        }}
      >
        {children}
      </a>
      {shouldConfirm
        ? linkSafetyConfig.renderModal?.({
            url: safeHref,
            isOpen,
            onClose,
            onConfirm,
          })
        : null}
    </>
  );
}

const commentMarkdownComponents = { a: CommentMarkdownLink };
const NO_KNOWN_ISSUE_IDS: ReadonlySet<string> = new Set();

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
  /** Known issue ids shared with the body renderer's reference context. */
  knownIssueIds?: ReadonlySet<string>;
  /** Active vault used to build navigable known-issue hrefs. */
  vault?: string;
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
  onDelete,
  onReply,
  replyToAuthor,
  resolveMarkdownUrl,
  knownIssueIds = NO_KNOWN_ISSUE_IDS,
  vault = "",
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
  const knownIssueFingerprint = useMemo(
    () => [...knownIssueIds].sort().join("\u0000"),
    [knownIssueIds],
  );
  const markdownFingerprint = useMemo(
    () =>
      `${comment.id}:${comment.body}:${[...mentionUsernames].sort().join(",")}:${vault}:${knownIssueFingerprint}`,
    [comment.body, comment.id, knownIssueFingerprint, mentionUsernames, vault],
  );
  const remarkPlugins = useMemo<RemarkPlugins>(() => {
    const plugins: NonNullable<RemarkPlugins> = [
      ...Object.values(defaultRemarkPlugins),
      [
        remarkCommentMentions,
        {
          knownUsernames: mentionUsernames,
          cacheFingerprint: markdownFingerprint,
        },
      ],
    ];
    if (knownIssueIds.size > 0) {
      plugins.push([
        remarkReefMentions,
        {
          isKnown: (id: string) => knownIssueIds.has(id),
          hrefFor: (id: string) =>
            withVault(vault, `/issues/${encodeURIComponent(id)}`),
          cacheFingerprint: knownIssueFingerprint,
        },
      ]);
    }
    return plugins;
  }, [
    knownIssueFingerprint,
    knownIssueIds,
    markdownFingerprint,
    mentionUsernames,
    vault,
  ]);

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

  const urlTransform = useMemo<UrlTransform>(
    () => (url, key, node) => {
      const resolved = resolveMarkdownUrl?.(url, key, node) ?? url;
      if (resolved !== url) return resolved;
      if (isAkbFileUri(url) || parseAkbDocumentUri(url)) return url;
      return defaultUrlTransform(url, key, node);
    },
    [resolveMarkdownUrl],
  );

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
                  hitTarget="compact"
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
                  hitTarget="compact"
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
                  hitTarget="compact"
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
            key={markdownFingerprint}
            className="reef-markdown-surface reef-markdown-comment comment-mention-renderer mt-1 w-full min-w-0 break-words text-[13px] text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            components={commentMarkdownComponents}
            linkSafety={linkSafetyConfig}
            rehypePlugins={issueMarkdownRehypePlugins}
            urlTransform={urlTransform}
            remarkPlugins={remarkPlugins}
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
