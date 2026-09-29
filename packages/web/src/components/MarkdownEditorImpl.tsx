"use client";

import {
  MarkdownLocaleProvider,
  MarkdownSurface,
  MarkdownToolbar,
  MarkdownToolbarButton,
  MarkdownToolbarGroup,
  useMarkdownCommands,
  useMarkdownEditor,
  useMarkdownReferenceResolutions,
  useMarkdownState,
  useMarkdownTargetResolutions,
  type MarkdownLocale,
  type MarkdownReferenceAdapter,
  type MarkdownReferenceCandidate,
  type MarkdownReferenceResolution,
} from "@akb/markdown-editor/react";
import {
  parseMarkdown,
  serializeMarkdown,
  type MarkdownAsset,
  type MarkdownCommands,
  type MarkdownNode,
  type MarkdownTargetResolution,
} from "@akb/markdown-editor";
import { Button } from "@/components/ui/button";
import { linkSafetyConfig } from "@/components/markdown/linkSafety";
import { isAkbFileUri } from "@/features/issues/lib/attachmentUrls";
import { filterIssueBodyMentionCandidates } from "@/features/issues/lib/issueBodyMentionCandidates";
import {
  appendMarkdownSnippets,
  filesFromFileList,
} from "@/features/issues/lib/attachmentMarkdown";
import {
  normalizeUrl,
  openLinkWindow,
} from "@/components/markdown-editor/links";
import {
  extractAkbDocumentUris,
  normalizeAkbDocumentMarkdownLinks,
} from "@/lib/akb/markdownDocumentLinks";
import { resolveAkbDocumentTitles } from "@/lib/akb/documentTitleResolver";
import { cn } from "@/lib/utils";
import { useAkbWebUrl } from "@/providers/AkbWebUrlProvider";
import { formatMentionToken } from "@reef/core";
import { useLocale, useTranslations } from "next-intl";
import { Paperclip } from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EDITOR_BODY_FRAME_CLASS,
  EDITOR_BODY_SIZING,
  EDITOR_CONTENT_CLASS,
  EDITOR_MANUAL_SCROLL_SURFACE_CLASS,
  EDITOR_MANUAL_SOURCE_CLASS,
  EDITOR_RESIZABLE_BODY_ID,
  MARKDOWN_SURFACE_CLASS,
  useMarkdownEditorHeightResize,
} from "./markdown-editor/heightResize";
import {
  openClickedEditorLink,
  openEditorLinkOnMouseUp,
  preventEditorSelectionOnLinkMouseDown,
} from "./markdown-editor/links";
import { MarkdownEditorResizeHandle } from "./markdown-editor/ResizeHandle";
import type { MarkdownEditorProps } from "./markdown-editor/types";
import { useOverlayOpenRegistration } from "./ui/overlayDismiss";

function localeForMarkdownEditor(locale: string): MarkdownLocale {
  if (locale !== "en" && locale !== "ko") {
    throw new Error(`Unsupported markdown editor locale: ${locale}`);
  }
  return locale;
}

function markdownForAsset(asset: MarkdownAsset): string | null {
  if (asset.kind !== "attachment") return null;
  return serializeMarkdown({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "image",
            attrs: {
              target: asset.target,
              alt: asset.alt ?? "",
              title: asset.title ?? null,
            },
          },
        ],
      },
    ],
  });
}

function legacyImageResolutions(
  markdown: string,
  resolveImageSrc: ((src: string) => string) | undefined,
): ReadonlyMap<string, MarkdownTargetResolution> {
  if (!resolveImageSrc) return new Map();
  const resolutions = new Map<string, MarkdownTargetResolution>();
  const visit = (node: MarkdownNode) => {
    if (node.type === "image") {
      const target = node.attrs?.target;
      if (typeof target === "string" && isAkbFileUri(target)) {
        resolutions.set(target, {
          target,
          kind: "file",
          status: "available",
          runtimeUrl: resolveImageSrc(target),
        });
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of parseMarkdown(markdown, { profile: "preserve" }).content ??
    []) {
    visit(node);
  }
  return resolutions;
}

function MarkdownEditorContent({
  value,
  onChange,
  placeholder = "Describe the issue…",
  sourcePlaceholder,
  className,
  readOnly = false,
  ariaLabel,
  onBlur,
  vault,
  onUploadFiles,
  adapters,
  resolverContext,
  resolveImageSrc,
  mentionConfig,
  enableHeightResize = false,
  preferredHeight,
  bodyFrameRef,
}: MarkdownEditorProps) {
  const t = useTranslations("markdownEditor");
  const akbWebBase = useAkbWebUrl();
  const latestValueRef = useRef(value);
  const lastSyncedValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const commandsRef = useRef<MarkdownCommands | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const titleByUriRef = useRef(new Map<string, string | null>());
  const pendingTitleUrisRef = useRef(new Set<string>());
  const activeVaultRef = useRef(vault);
  const mentionOpenDismissRef = useRef<(() => void) | null>(null);
  const slashOpenDismissRef = useRef<(() => void) | null>(null);
  const linksOpenedFromMouseUpRef = useRef(
    new WeakMap<HTMLAnchorElement, number>(),
  );
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceValue, setSourceValue] = useState(value);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [externalLinkHref, setExternalLinkHref] = useState<string | null>(null);

  const normalizeMarkdown = useCallback(
    (markdown: string) =>
      normalizeAkbDocumentMarkdownLinks(markdown, titleByUriRef.current),
    [],
  );
  const initialMarkdown = useMemo(
    () => normalizeAkbDocumentMarkdownLinks(value),
    [value],
  );

  const mentionReferenceAdapter = useMemo<
    MarkdownReferenceAdapter | undefined
  >(() => {
    if (!mentionConfig) return undefined;
    const config = mentionConfig;
    return {
      async search(query, context) {
        const localCandidates = filterIssueBodyMentionCandidates(
          config.members,
          config.issues,
          query,
        );
        const candidates: MarkdownReferenceCandidate[] = localCandidates.map(
          (candidate) => {
            if (candidate.kind === "person") {
              return {
                id: candidate.member.username,
                kind: "person",
                title: config.mentionOptionLabel(candidate.member.username),
                subtitle:
                  candidate.member.display_name ?? candidate.member.username,
                value: formatMentionToken(candidate.member.username),
              };
            }
            return {
              id: candidate.issue.id,
              kind: "issue",
              title: config.issueOptionLabel(candidate.issue),
              subtitle: candidate.issue.id,
              value: candidate.issue.id,
            };
          },
        );
        const searchDocuments = config.searchDocuments;
        if (searchDocuments) {
          const documents = await searchDocuments(
            query,
            context?.signal ?? new AbortController().signal,
          );
          for (const hit of documents) {
            candidates.push({
              id: hit.uri,
              kind: "document",
              title: hit.title ?? config.documentOptionLabel(hit),
              subtitle: config.documentOptionLabel(hit),
              target: hit.uri,
            });
          }
        }
        return candidates;
      },
      async resolve(reference, context): Promise<MarkdownReferenceResolution> {
        if (reference.kind === "person") {
          const member = config.members.find(
            (candidate) =>
              candidate.username.toLocaleLowerCase() ===
              reference.id.toLocaleLowerCase(),
          );
          if (!member) {
            return {
              ...reference,
              status: "unavailable",
              reason: "inaccessible",
            };
          }
          return {
            ...reference,
            status: "available",
            title: config.mentionOptionLabel(member.username),
            subtitle: member.display_name ?? member.username,
          };
        }

        const issue = config.issues.find(
          (candidate) => candidate.id === reference.id,
        );
        if (!issue) {
          return {
            ...reference,
            status: "unavailable",
            reason: "inaccessible",
          };
        }
        const referenceVault = context?.vault ?? vault;
        return {
          ...reference,
          status: "available",
          title: issue.title,
          subtitle: issue.id,
          ...(referenceVault
            ? {
                runtimeUrl: `/workspace/${encodeURIComponent(referenceVault)}/issues/${encodeURIComponent(issue.id)}`,
              }
            : {}),
        };
      },
    };
  }, [mentionConfig, vault]);

  const handleMentionOpenChange = useCallback(
    (open: boolean, dismiss?: () => void) => {
      mentionOpenDismissRef.current = open ? (dismiss ?? null) : null;
      setMentionOpen(open);
    },
    [],
  );
  const handleSlashOpenChange = useCallback(
    (open: boolean, dismiss?: () => void) => {
      slashOpenDismissRef.current = open ? (dismiss ?? null) : null;
      setSlashOpen(open);
    },
    [],
  );
  const slashOptions = useMemo(
    () => ({ onOpenChange: handleSlashOpenChange }),
    [handleSlashOpenChange],
  );
  const mentionOptions = useMemo(
    () =>
      mentionReferenceAdapter
        ? {
            adapter: mentionReferenceAdapter,
            context: { vault },
            onOpenChange: handleMentionOpenChange,
          }
        : undefined,
    [handleMentionOpenChange, mentionReferenceAdapter, vault],
  );

  const queueDocumentTitleResolution = useCallback(
    (markdown: string) => {
      if (!vault || activeVaultRef.current !== vault) return;
      const unresolved = extractAkbDocumentUris(markdown).filter(
        (uri) =>
          !titleByUriRef.current.has(uri) &&
          !pendingTitleUrisRef.current.has(uri),
      );
      if (unresolved.length === 0) return;
      for (const uri of unresolved) pendingTitleUrisRef.current.add(uri);
      void resolveAkbDocumentTitles(vault, unresolved).then((titles) => {
        if (activeVaultRef.current !== vault) return;
        for (const uri of unresolved) {
          pendingTitleUrisRef.current.delete(uri);
          titleByUriRef.current.set(uri, titles.get(uri) ?? null);
        }
        const next = normalizeMarkdown(latestValueRef.current);
        if (next === latestValueRef.current) return;
        latestValueRef.current = next;
        lastSyncedValueRef.current = next;
        setSourceValue(next);
        onChangeRef.current(next);
        commandsRef.current?.setMarkdown(next);
        if (!rootRef.current?.contains(document.activeElement)) {
          onBlurRef.current?.(next);
        }
      });
    },
    [normalizeMarkdown, vault],
  );

  const publishMarkdown = useCallback(
    (rawMarkdown: string) => {
      const markdown = normalizeMarkdown(rawMarkdown);
      const changed = markdown !== lastSyncedValueRef.current;
      latestValueRef.current = markdown;
      lastSyncedValueRef.current = markdown;
      if (!sourceMode) setSourceValue(markdown);
      if (markdown !== rawMarkdown) commandsRef.current?.setMarkdown(markdown);
      if (changed) onChangeRef.current(markdown);
      queueDocumentTitleResolution(markdown);
    },
    [normalizeMarkdown, queueDocumentTitleResolution, sourceMode],
  );

  const editor = useMarkdownEditor({
    initialMarkdown,
    profile: "preserve",
    editable: !readOnly,
    onChange: (markdown) => publishMarkdown(markdown),
    slash: slashOptions,
    reference: mentionOptions,
  });
  const commands = useMarkdownCommands(editor);
  const state = useMarkdownState(editor);
  const targetResolver = adapters?.targetResolver;
  const targetResolutions = useMarkdownTargetResolutions(
    value,
    targetResolver,
    { vault, ...resolverContext },
  );
  const resolutions = useMemo(
    () =>
      new Map([
        ...targetResolutions,
        ...legacyImageResolutions(value, resolveImageSrc),
      ]),
    [resolveImageSrc, targetResolutions, value],
  );
  const referenceResolutions = useMarkdownReferenceResolutions(
    value,
    mentionReferenceAdapter,
    { vault, ...resolverContext },
  );
  const {
    isResizeAvailable,
    isManual,
    isResizing,
    maxHeight,
    currentHeight,
    bodyFrameStyle,
    onKeyDown: onResizeKeyDown,
    onLostPointerCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = useMarkdownEditorHeightResize(enableHeightResize, preferredHeight);

  useEffect(() => {
    commandsRef.current = commands;
  }, [commands]);
  useEffect(() => {
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
  }, [onBlur, onChange]);
  useEffect(() => {
    if (activeVaultRef.current === vault) return;
    activeVaultRef.current = vault;
    titleByUriRef.current.clear();
    pendingTitleUrisRef.current.clear();
  }, [vault]);
  useEffect(() => {
    const normalized = normalizeMarkdown(value);
    latestValueRef.current = normalized;
    if (normalized !== lastSyncedValueRef.current) {
      lastSyncedValueRef.current = normalized;
      if (normalized !== value) onChangeRef.current(normalized);
      commands.setMarkdown(normalized);
      setSourceValue(normalized);
    }
    queueDocumentTitleResolution(normalized);
  }, [commands, normalizeMarkdown, queueDocumentTitleResolution, value]);

  const handleBlur = useCallback(() => {
    onBlurRef.current?.(latestValueRef.current);
  }, []);

  const handleSourceChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const next = normalizeMarkdown(event.currentTarget.value);
      latestValueRef.current = next;
      lastSyncedValueRef.current = next;
      setSourceValue(next);
      onChangeRef.current(next);
      commands.setMarkdown(next);
      queueDocumentTitleResolution(next);
    },
    [commands, normalizeMarkdown, queueDocumentTitleResolution],
  );

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!onUploadFiles || readOnly || uploadingFiles) return;
      setUploadingFiles(true);
      setUploadError(false);
      try {
        const result = await onUploadFiles(files);
        if (result.failed > 0 || result.cancelled > 0) setUploadError(true);
        const snippets = result.items
          .filter(
            (item): item is Extract<typeof item, { status: "success" }> =>
              item.status === "success" && item.asset.kind === "attachment",
          )
          .map((item) => markdownForAsset(item.asset))
          .filter((markdown): markdown is string => markdown !== null);
        const current = latestValueRef.current;
        const next = appendMarkdownSnippets(current, snippets);
        if (next === current) return;
        latestValueRef.current = next;
        lastSyncedValueRef.current = next;
        setSourceValue(next);
        onChangeRef.current(next);
        commands.setMarkdown(next);
        queueDocumentTitleResolution(next);
        if (!rootRef.current?.contains(document.activeElement)) {
          onBlurRef.current?.(next);
        }
      } catch {
        setUploadError(true);
      } finally {
        setUploadingFiles(false);
      }
    },
    [
      commands,
      onUploadFiles,
      queueDocumentTitleResolution,
      readOnly,
      uploadingFiles,
    ],
  );

  const openFilePicker = useCallback(() => {
    if (readOnly || uploadingFiles || !onUploadFiles) return;
    fileInputRef.current?.click();
  }, [onUploadFiles, readOnly, uploadingFiles]);
  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = filesFromFileList(event.currentTarget.files);
      event.currentTarget.value = "";
      if (files.length > 0) void handleUploadFiles(files);
    },
    [handleUploadFiles],
  );
  const handleSourcePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = filesFromFileList(event.clipboardData.files);
      if (!files.length || !onUploadFiles || readOnly) return;
      event.preventDefault();
      void handleUploadFiles(files);
    },
    [handleUploadFiles, onUploadFiles, readOnly],
  );
  const handleSourceDrop = useCallback(
    (event: DragEvent<HTMLTextAreaElement>) => {
      const files = filesFromFileList(event.dataTransfer.files);
      if (!files.length || !onUploadFiles || readOnly) return;
      event.preventDefault();
      void handleUploadFiles(files);
    },
    [handleUploadFiles, onUploadFiles, readOnly],
  );
  const handleSurfacePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const files = filesFromFileList(event.clipboardData.files);
      if (!files.length || !onUploadFiles || readOnly) return;
      event.preventDefault();
      void handleUploadFiles(files);
    },
    [handleUploadFiles, onUploadFiles, readOnly],
  );
  const handleSurfaceDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const files = filesFromFileList(event.dataTransfer.files);
      if (!files.length || !onUploadFiles || readOnly) return;
      event.preventDefault();
      void handleUploadFiles(files);
    },
    [handleUploadFiles, onUploadFiles, readOnly],
  );
  const handleSurfaceDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (onUploadFiles && !readOnly && event.dataTransfer.files.length > 0) {
        event.preventDefault();
      }
    },
    [onUploadFiles, readOnly],
  );

  const focusEditor = useCallback(() => {
    commands.focus();
  }, [commands]);
  const toggleSourceMode = useCallback(() => {
    if (readOnly) return;
    if (sourceMode) {
      const next = normalizeMarkdown(sourceValue);
      latestValueRef.current = next;
      lastSyncedValueRef.current = next;
      commands.setMarkdown(next);
      onChangeRef.current(next);
      queueDocumentTitleResolution(next);
      setSourceMode(false);
      requestAnimationFrame(focusEditor);
      return;
    }
    setSourceValue(latestValueRef.current);
    setSourceMode(true);
  }, [
    commands,
    focusEditor,
    normalizeMarkdown,
    queueDocumentTitleResolution,
    readOnly,
    sourceMode,
    sourceValue,
  ]);

  const mentionDismiss = useCallback(() => {
    mentionOpenDismissRef.current?.();
  }, []);
  useOverlayOpenRegistration(
    Boolean(mentionConfig && mentionOpen),
    mentionDismiss,
  );
  const dismissSlash = useCallback(() => {
    slashOpenDismissRef.current?.();
  }, []);
  useOverlayOpenRegistration(slashOpen, dismissSlash);

  const handleSurfaceClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      openClickedEditorLink(
        surface,
        event.nativeEvent,
        linksOpenedFromMouseUpRef.current,
        setExternalLinkHref,
        akbWebBase,
      );
    },
    [akbWebBase],
  );
  const handleSurfaceMouseDownCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const surface = surfaceRef.current;
      if (surface)
        preventEditorSelectionOnLinkMouseDown(surface, event.nativeEvent);
    },
    [],
  );
  const handleSurfaceMouseUpCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      openEditorLinkOnMouseUp(
        surface,
        event.nativeEvent,
        linksOpenedFromMouseUpRef.current,
        setExternalLinkHref,
        akbWebBase,
      );
    },
    [akbWebBase],
  );

  const editorBodyClassName = cn(
    EDITOR_CONTENT_CLASS,
    MARKDOWN_SURFACE_CLASS,
    "prose prose-sm focus:outline-none px-3 py-2 max-w-none",
  );
  const toolbarLabels = useMemo(
    () => ({
      source: t("source"),
      toggleSourceMode: t("toggleSourceMode"),
      attachFile: t("attachFile"),
      resizeHandle: t("resizeHandle"),
      resizeHandleDescription: (values: {
        current: string;
        min: string;
        max: string;
      }) => t("resizeHandleDescription", values),
    }),
    [t],
  );

  return (
    <div
      ref={rootRef}
      data-testid="markdown-editor"
      data-reef-editable-markdown={readOnly ? undefined : ""}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          handleBlur();
        }
      }}
      className={cn(
        "relative isolate rounded-md border border-border bg-surface-elevated transition-colors duration-150 after:pointer-events-none after:absolute after:inset-0 after:z-20 after:rounded-[inherit] after:content-[''] focus-within:border-brand-focus focus-within:after:ring-2 focus-within:after:ring-inset focus-within:after:ring-brand-focus",
        className,
      )}
    >
      {!readOnly ? (
        <div
          data-testid="markdown-toolbar"
          className="flex items-start gap-1 border-b border-border-subtle px-2 py-1"
        >
          <div
            data-testid="markdown-toolbar-controls"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
          >
            <MarkdownToolbar
              editor={sourceMode ? null : editor}
              className="min-w-0 flex-1 border-0 bg-transparent px-0 py-0"
              link={{ normalizeUrl }}
            >
              {onUploadFiles ? (
                <MarkdownToolbarGroup label={toolbarLabels.attachFile}>
                  <MarkdownToolbarButton
                    label={toolbarLabels.attachFile}
                    disabled={uploadingFiles}
                    onClick={openFilePicker}
                  >
                    <Paperclip className="h-4 w-4" aria-hidden="true" />
                  </MarkdownToolbarButton>
                </MarkdownToolbarGroup>
              ) : null}
            </MarkdownToolbar>
            {onUploadFiles ? (
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                aria-label={toolbarLabels.attachFile}
                data-testid="markdown-attachment-input"
                onChange={handleInputChange}
              />
            ) : null}
          </div>
          <div data-testid="markdown-source-toggle" className="shrink-0">
            <Button
              type="button"
              variant={sourceMode ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={sourceMode}
              onClick={toggleSourceMode}
              className="h-7 px-2 text-xs font-mono"
              title={toolbarLabels.toggleSourceMode}
            >
              {toolbarLabels.source}
            </Button>
          </div>
        </div>
      ) : null}

      {(uploadingFiles || uploadError) && (
        <div
          className="border-b border-border-subtle px-3 py-1.5 text-xs text-muted-foreground"
          role={uploadError ? "alert" : "status"}
        >
          {uploadError ? t("uploadError") : t("uploading")}
        </div>
      )}

      <div
        ref={bodyFrameRef}
        id={enableHeightResize ? EDITOR_RESIZABLE_BODY_ID : undefined}
        data-testid="markdown-editor-body-frame"
        className={cn(
          EDITOR_BODY_FRAME_CLASS,
          enableHeightResize && isResizeAvailable && "relative",
          isManual && "min-h-0 overflow-hidden mr-1 mb-1",
        )}
        style={bodyFrameStyle}
      >
        <div
          ref={surfaceRef}
          hidden={sourceMode}
          className={cn(
            "relative min-w-0",
            isManual ? EDITOR_MANUAL_SCROLL_SURFACE_CLASS : EDITOR_BODY_SIZING,
          )}
          onClickCapture={handleSurfaceClickCapture}
          onMouseDownCapture={handleSurfaceMouseDownCapture}
          onMouseUpCapture={handleSurfaceMouseUpCapture}
          onPasteCapture={handleSurfacePaste}
          onDropCapture={handleSurfaceDrop}
          onDragOverCapture={handleSurfaceDragOver}
        >
          <MarkdownSurface
            editor={editor}
            editable={!readOnly}
            className="relative min-w-0"
            contentClassName={editorBodyClassName}
            contentAttributes={{
              "data-testid": "markdown-editor-content",
              ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
              ...(mentionConfig
                ? { "aria-autocomplete": "list", "aria-expanded": false }
                : {}),
            }}
            resolutions={resolutions}
            resolvingTargets={Boolean(targetResolver)}
            referenceResolutions={referenceResolutions}
            resolvingReferences={Boolean(mentionReferenceAdapter?.resolve)}
          />
          {!readOnly && state?.isEmpty ? (
            <div
              aria-hidden="true"
              data-testid="markdown-editor-placeholder"
              className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground"
            >
              {placeholder}
            </div>
          ) : null}
        </div>

        {sourceMode ? (
          <textarea
            value={sourceValue}
            onChange={handleSourceChange}
            onPaste={handleSourcePaste}
            onDrop={handleSourceDrop}
            onDragOver={(event) => {
              if (
                onUploadFiles &&
                !readOnly &&
                event.dataTransfer.files.length > 0
              ) {
                event.preventDefault();
              }
            }}
            readOnly={readOnly}
            aria-label={ariaLabel}
            className={cn(
              "w-full field-sizing-content rounded-sm bg-transparent px-3 py-2 text-sm font-mono focus:outline-none",
              isResizeAvailable ? "resize-none" : "resize-y",
              isManual ? EDITOR_MANUAL_SOURCE_CLASS : EDITOR_BODY_SIZING,
            )}
            placeholder={sourcePlaceholder ?? placeholder}
            data-testid="markdown-source-textarea"
          />
        ) : null}

        {enableHeightResize && isResizeAvailable ? (
          <MarkdownEditorResizeHandle
            currentHeight={currentHeight}
            maxHeight={maxHeight}
            isResizing={isResizing}
            labels={toolbarLabels}
            onKeyDown={onResizeKeyDown}
            onPointerCancel={onPointerCancel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onLostPointerCapture={onLostPointerCapture}
          />
        ) : null}
      </div>

      {externalLinkHref
        ? linkSafetyConfig.renderModal?.({
            url: externalLinkHref,
            isOpen: true,
            onClose: () => setExternalLinkHref(null),
            onConfirm: () => openLinkWindow(externalLinkHref),
          })
        : null}
    </div>
  );
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const nextIntlLocale = useLocale();
  const locale = localeForMarkdownEditor(nextIntlLocale);
  return (
    <MarkdownLocaleProvider locale={locale}>
      <MarkdownEditorContent {...props} />
    </MarkdownLocaleProvider>
  );
}
