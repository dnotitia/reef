"use client";

import {
  MarkdownLocaleProvider,
  MarkdownEditingSurface,
  MarkdownSurface,
  MarkdownToolbar,
  MarkdownToolbarButton,
  MarkdownToolbarGroup,
  useMarkdownCommands,
  useMarkdownEditor,
  useMarkdownImageUploadContext,
  useMarkdownReferenceResolutions,
  useMarkdownState,
  useMarkdownTargetResolutions,
  type MarkdownLocale,
  type MarkdownEditingSurfaceProps,
  type MarkdownEditorMode,
  type MarkdownImageOptions,
  type MarkdownImageMenuOptions,
  type MarkdownImageUploadOptions,
  type MarkdownReferenceAdapter,
  type MarkdownReferenceCandidate,
  type MarkdownReferenceResolution,
} from "@akb/markdown-editor/react";
import { Button } from "@/components/ui/button";
import { linkSafetyConfig } from "@/components/markdown/linkSafety";
import { isAkbFileUri } from "@/features/issues/lib/attachmentUrls";
import { filterIssueBodyMentionCandidates } from "@/features/issues/lib/issueBodyMentionCandidates";
import { filesFromFileList } from "@/features/issues/lib/attachmentMarkdown";
import {
  normalizeUrl,
  openLinkWindow,
} from "@/components/markdown-editor/links";
import {
  extractAkbDocumentUris,
  normalizeAkbDocumentMarkdownLinks,
  normalizeAkbDocumentMarkdownLinksForUris,
  normalizeExistingAkbDocumentMarkdownLinks,
} from "@/lib/akb/markdownDocumentLinks";
import { resolveAkbDocumentTitles } from "@/lib/akb/documentTitleResolver";
import { markdownResourceSearchAdapter } from "@/lib/akb/markdownResourceSearch";
import { cn } from "@/lib/utils";
import { formatMentionToken } from "@reef/core";
import { useLocale, useTranslations } from "next-intl";
import { Paperclip } from "lucide-react";
import { createPortal } from "react-dom";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EDITOR_BODY_FRAME_CLASS,
  EDITOR_BODY_MANUAL_FRAME_MARGIN_PX,
  EDITOR_BODY_SIZING,
  EDITOR_CONTENT_CLASS,
  EDITOR_MANUAL_SCROLL_SURFACE_CLASS,
  EDITOR_MANUAL_SOURCE_CLASS,
  EDITOR_SOURCE_CONTENT_CLASS,
  EDITOR_RESIZABLE_BODY_ID,
  MARKDOWN_SURFACE_CLASS,
  useMarkdownEditorHeightResize,
} from "./markdown-editor/heightResize";
import {
  openClickedEditorLink,
  openEditorLinkOnMouseUp,
  openFocusedEditorLink,
  preventUnavailableEditorLinkBehavior,
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

const ISSUE_MARKDOWN_IMAGE_OPTIONS: MarkdownImageOptions = {
  classNames: {
    frame: "block max-w-full align-top",
    image: "block h-auto max-w-full",
    message:
      "my-4 flex min-h-12 max-w-full items-center justify-center whitespace-normal break-words rounded-md border border-border-subtle bg-surface-subtle px-4 py-3 text-sm text-muted-foreground",
  },
};

const ISSUE_IMAGE_MENU_OPTIONS: MarkdownImageMenuOptions = {
  classNames: {
    host: "border-border-subtle bg-surface-elevated shadow-md",
    action:
      "text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-brand-focus focus-visible:ring-offset-surface-elevated",
    destructiveAction:
      "text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-brand-focus focus-visible:ring-offset-surface-elevated",
    dialog: "border-border-subtle bg-surface-elevated text-foreground",
    field:
      "border-border bg-surface text-foreground placeholder:text-muted-foreground focus-visible:ring-brand-focus focus-visible:ring-offset-surface-elevated",
    error: "text-destructive",
  },
  isEditableTarget: (target) =>
    isAkbFileUri(target) ||
    (target.startsWith("/") && !target.startsWith("//")),
};

const ISSUE_IMAGE_UPLOAD_CLASS_NAMES: NonNullable<
  MarkdownImageUploadOptions["classNames"]
> = {
  status: "border-x border-b border-border-subtle px-3 py-2 text-sm",
  actions: "flex flex-wrap items-center gap-1.5",
  action:
    "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:cursor-not-allowed disabled:opacity-50",
  input: "hidden",
};

function isImageUploadFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function MarkdownAttachmentPicker({
  label,
  disabled,
  onFiles,
  onImageFiles,
  onUnsupportedImage,
}: {
  label: string;
  disabled: boolean;
  onFiles: (files: File[]) => void;
  onImageFiles: (
    files: readonly File[],
    selectFiles: (files: readonly File[]) => void,
  ) => void;
  onUnsupportedImage: () => void;
}) {
  const imageUpload = useMarkdownImageUploadContext();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = filesFromFileList(event.currentTarget.files);
    event.currentTarget.value = "";
    const images = files.filter(isImageUploadFile);
    const attachments = files.filter((file) => !isImageUploadFile(file));
    if (images.length > 0) {
      if (imageUpload) onImageFiles(images, imageUpload.selectFiles);
      else onUnsupportedImage();
    }
    if (attachments.length > 0) onFiles(attachments);
  };

  return (
    <>
      <MarkdownToolbarGroup label={label}>
        <MarkdownToolbarButton
          label={label}
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
        </MarkdownToolbarButton>
      </MarkdownToolbarGroup>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        aria-label={label}
        data-testid="markdown-attachment-input"
        onChange={handleInputChange}
      />
    </>
  );
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
  imageUpload,
  adapters,
  resolverContext,
  sourceContextKey,
  mentionConfig,
  enableHeightResize = false,
  preferredHeight,
  bodyFrameRef,
}: MarkdownEditorProps) {
  const t = useTranslations("markdownEditor");
  const latestValueRef = useRef(value);
  const lastSyncedValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const commandsRef = useRef<ReturnType<typeof useMarkdownCommands> | null>(
    null,
  );
  const sourceStateRef = useRef<
    NonNullable<ReturnType<typeof useMarkdownState>>["source"] | null
  >(null);
  const mountedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef<MarkdownEditorMode>("wysiwyg");
  // Keep the package's mode authoritative while gating its image action target.
  const imageMenuOptions = useMemo<MarkdownImageMenuOptions>(
    () => ({
      ...ISSUE_IMAGE_MENU_OPTIONS,
      isEditableTarget: (target) =>
        modeRef.current === "wysiwyg" &&
        (ISSUE_IMAGE_MENU_OPTIONS.isEditableTarget?.(target) ?? false),
    }),
    [],
  );
  const modeChangeRef = useRef<((mode: MarkdownEditorMode) => void) | null>(
    null,
  );
  const sourceApplyPendingRef = useRef(false);
  const restoreSourceAfterUploadRef = useRef(false);
  const titleByUriRef = useRef(new Map<string, string | null>());
  const sourceTitleAttemptsRef = useRef(new Set<string>());
  const pendingTitleUrisRef = useRef(new Set<string>());
  const activeVaultRef = useRef(vault);
  const surfaceSourceContextKey = JSON.stringify([
    vault ?? "",
    resolverContext?.document ?? "",
    resolverContext?.commit ?? "",
    sourceContextKey ?? "",
  ]);
  const sourceContextKeyRef = useRef(surfaceSourceContextKey);
  const mentionOpenDismissRef = useRef<(() => void) | null>(null);
  const slashOpenDismissRef = useRef<(() => void) | null>(null);
  const linksOpenedFromMouseUpRef = useRef(
    new WeakMap<HTMLAnchorElement, number>(),
  );
  const [headerOutlet, setHeaderOutlet] = useState<HTMLDivElement | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [externalLinkHref, setExternalLinkHref] = useState<string | null>(null);
  const imageUploadOptions = useMemo(() => {
    if (!imageUpload) return undefined;
    return {
      ...imageUpload,
      classNames: {
        ...ISSUE_IMAGE_UPLOAD_CLASS_NAMES,
        ...imageUpload.classNames,
      },
    };
  }, [imageUpload]);
  const normalizeMarkdown = useCallback(
    (markdown: string) =>
      normalizeExistingAkbDocumentMarkdownLinks(
        markdown,
        titleByUriRef.current,
      ),
    [],
  );
  const normalizeWysiwygMarkdown = useCallback(
    (
      markdown: string,
      titles: ReadonlyMap<
        string,
        string | null | undefined
      > = titleByUriRef.current,
    ) => normalizeAkbDocumentMarkdownLinks(markdown, titles),
    [],
  );
  const applyResolvedDocumentTitles = useCallback(
    (
      markdown: string,
      expectedContextKey: string,
      sourceSnapshot = sourceStateRef.current,
      titles: ReadonlyMap<
        string,
        string | null | undefined
      > = titleByUriRef.current,
      sourceUris: readonly string[] = [...titles.keys()],
    ) => {
      if (
        !vault ||
        activeVaultRef.current !== vault ||
        sourceContextKeyRef.current !== expectedContextKey
      ) {
        return false;
      }
      if (modeRef.current === "source" || sourceSnapshot?.mode === "source") {
        if (modeRef.current !== "source") return false;
        const source = sourceSnapshot;
        const currentSource = sourceStateRef.current;
        if (
          !source ||
          source.mode !== "source" ||
          !currentSource ||
          currentSource.mode !== "source" ||
          currentSource.session !== source.session
        ) {
          return false;
        }
        if (
          source.markdown !== markdown ||
          currentSource.revision !== source.revision ||
          currentSource.markdown !== source.markdown
        ) {
          return true;
        }
        const normalized = normalizeAkbDocumentMarkdownLinksForUris(
          source.markdown,
          titles,
          sourceUris,
        );
        if (normalized === source.markdown) return true;

        let from = 0;
        while (
          from < source.markdown.length &&
          from < normalized.length &&
          source.markdown[from] === normalized[from]
        ) {
          from += 1;
        }
        let to = source.markdown.length;
        let replacementTo = normalized.length;
        while (
          to > from &&
          replacementTo > from &&
          source.markdown[to - 1] === normalized[replacementTo - 1]
        ) {
          to -= 1;
          replacementTo -= 1;
        }

        const result = commandsRef.current?.applySourceChange({
          revision: source.revision,
          session: source.session,
          from,
          to,
          expectedText: source.markdown.slice(from, to),
          replacementText: normalized.slice(from, replacementTo),
        });
        if (!result) return false;
        if (result.applied) return true;
        switch (result.reason) {
          case "source-inactive":
          case "read-only":
          case "composing":
            return false;
          case "stale":
          case "invalid-range":
          case "target-mismatch":
          case "unchanged":
            return true;
        }
        return false;
      }

      const current = latestValueRef.current;
      const normalized = normalizeAkbDocumentMarkdownLinks(current, titles);
      if (normalized === current) return true;
      latestValueRef.current = normalized;
      lastSyncedValueRef.current = normalized;
      onChangeRef.current(normalized);
      commandsRef.current?.setMarkdown(normalized);
      if (!rootRef.current?.contains(document.activeElement)) {
        onBlurRef.current?.(normalized);
      }
      return true;
    },
    [vault],
  );
  const initialMarkdown = useMemo(
    () => normalizeExistingAkbDocumentMarkdownLinks(value),
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
              title: candidate.issue.title,
              subtitle: candidate.issue.id,
              value: candidate.issue.id,
            };
          },
        );
        if (config.searchAdapter) {
          try {
            const resources = await config.searchAdapter.search(query, {
              vault: context?.vault ?? vault,
              signal: context?.signal,
            });
            for (const resource of resources) {
              if (resource.kind !== "document" && resource.kind !== "file") {
                continue;
              }
              candidates.push({
                id: resource.id,
                kind: resource.kind,
                title: resource.title,
                ...(resource.snippet ? { snippet: resource.snippet } : {}),
                target: resource.target,
              });
            }
          } catch (error) {
            if (candidates.length === 0) throw error;
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
      const requestContextKey = sourceContextKeyRef.current;
      const requestSourceSnapshot = sourceStateRef.current;
      const inSource =
        modeRef.current === "source" &&
        requestSourceSnapshot?.mode === "source";
      const sourceAttemptKey = (uri: string) =>
        JSON.stringify([
          requestContextKey,
          requestSourceSnapshot?.session ?? "",
          uri,
        ]);
      const pendingKey = (uri: string) =>
        JSON.stringify([
          requestContextKey,
          inSource ? (requestSourceSnapshot?.session ?? "") : "",
          uri,
        ]);
      const documentUris = extractAkbDocumentUris(markdown);
      const candidates = inSource
        ? documentUris.filter(
            (uri) => !sourceTitleAttemptsRef.current.has(sourceAttemptKey(uri)),
          )
        : documentUris;
      const resolved = candidates.filter((uri) =>
        titleByUriRef.current.has(uri),
      );
      const resolvedTitles = new Map(
        resolved.map((uri) => [uri, titleByUriRef.current.get(uri)]),
      );
      if (inSource) {
        const complete = (uris: string[]) => {
          if (
            !applyResolvedDocumentTitles(
              markdown,
              requestContextKey,
              requestSourceSnapshot,
              resolvedTitles,
              uris,
            )
          ) {
            return;
          }
          for (const uri of uris) {
            sourceTitleAttemptsRef.current.add(sourceAttemptKey(uri));
          }
        };
        if (resolved.length > 0) complete(resolved);
      } else {
        applyResolvedDocumentTitles(
          markdown,
          requestContextKey,
          requestSourceSnapshot,
        );
      }

      const unresolved = candidates.filter(
        (uri) => !titleByUriRef.current.has(uri),
      );
      const requests = unresolved.filter(
        (uri) => !pendingTitleUrisRef.current.has(pendingKey(uri)),
      );
      if (!vault || requests.length === 0) return;
      for (const uri of requests) {
        pendingTitleUrisRef.current.add(pendingKey(uri));
      }
      void resolveAkbDocumentTitles(vault, requests).then((titles) => {
        if (!mountedRef.current) return;
        for (const uri of requests) {
          pendingTitleUrisRef.current.delete(pendingKey(uri));
        }
        if (
          activeVaultRef.current !== vault ||
          sourceContextKeyRef.current !== requestContextKey
        ) {
          return;
        }
        for (const uri of requests) {
          titleByUriRef.current.set(uri, titles.get(uri) ?? null);
        }
        const requestTitles = new Map(
          requests.map((uri) => [uri, titles.get(uri) ?? null]),
        );
        if (inSource) {
          if (
            !applyResolvedDocumentTitles(
              requestSourceSnapshot?.markdown ?? markdown,
              requestContextKey,
              requestSourceSnapshot,
              requestTitles,
              requests,
            )
          ) {
            return;
          }
          for (const uri of requests) {
            sourceTitleAttemptsRef.current.add(sourceAttemptKey(uri));
          }
          return;
        }
        const current =
          requestSourceSnapshot?.mode === "source"
            ? requestSourceSnapshot.markdown
            : latestValueRef.current;
        applyResolvedDocumentTitles(
          current,
          requestContextKey,
          requestSourceSnapshot,
        );
      });
    },
    [applyResolvedDocumentTitles, vault],
  );

  const publishMarkdown = useCallback(
    (rawMarkdown: string) => {
      const markdown = normalizeWysiwygMarkdown(rawMarkdown);
      const changed = markdown !== lastSyncedValueRef.current;
      latestValueRef.current = markdown;
      lastSyncedValueRef.current = markdown;
      if (markdown !== rawMarkdown) {
        commandsRef.current?.setMarkdown(markdown);
      }
      if (changed) onChangeRef.current(markdown);
      queueDocumentTitleResolution(markdown);
    },
    [normalizeWysiwygMarkdown, queueDocumentTitleResolution],
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
  const sourceMode = state?.source?.mode;
  const sourceMarkdown = state?.source?.markdown;
  const sourceIsComposing = state?.source?.isComposing;
  const targetResolver = adapters?.targetResolver;
  const targetResolutions = useMarkdownTargetResolutions(
    value,
    targetResolver,
    { vault, ...resolverContext },
  );
  const resolutions = targetResolutions;
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
  const bodyFrameLayoutStyle = {
    ...bodyFrameStyle,
    ...(isManual
      ? {
          marginBottom: `${EDITOR_BODY_MANUAL_FRAME_MARGIN_PX}px`,
          marginRight: `${EDITOR_BODY_MANUAL_FRAME_MARGIN_PX}px`,
        }
      : {}),
  };

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (sourceContextKeyRef.current !== surfaceSourceContextKey) {
      sourceTitleAttemptsRef.current.clear();
      pendingTitleUrisRef.current.clear();
    }
    commandsRef.current = commands;
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
    sourceStateRef.current = state?.source ?? null;
    sourceContextKeyRef.current = surfaceSourceContextKey;
  }, [commands, onBlur, onChange, state?.source, surfaceSourceContextKey]);
  useEffect(() => {
    if (activeVaultRef.current === vault) return;
    activeVaultRef.current = vault;
    titleByUriRef.current.clear();
    pendingTitleUrisRef.current.clear();
  }, [vault]);
  useEffect(() => {
    if (sourceContextKeyRef.current !== surfaceSourceContextKey) return;
    if (
      sourceMode === undefined ||
      sourceMarkdown === undefined ||
      sourceIsComposing
    ) {
      return;
    }
    queueDocumentTitleResolution(
      sourceMode === "source" ? sourceMarkdown : latestValueRef.current,
    );
  }, [
    queueDocumentTitleResolution,
    sourceIsComposing,
    sourceMarkdown,
    sourceMode,
    surfaceSourceContextKey,
  ]);
  useEffect(() => {
    if (sourceApplyPendingRef.current) {
      // Keep the pending Source edit as latest until the shared surface applies it.
      return;
    }
    if (modeRef.current === "source") {
      latestValueRef.current = value;
      lastSyncedValueRef.current = value;
      return;
    }
    const normalized = normalizeMarkdown(value);
    latestValueRef.current = normalized;
    if (normalized !== lastSyncedValueRef.current) {
      lastSyncedValueRef.current = normalized;
      if (normalized !== value) onChangeRef.current(normalized);
    }
    queueDocumentTitleResolution(normalized);
  }, [normalizeMarkdown, queueDocumentTitleResolution, value]);

  const handleBlur = useCallback(() => {
    onBlurRef.current?.(latestValueRef.current);
  }, []);

  const handleSourceChange = useCallback((rawMarkdown: string) => {
    sourceApplyPendingRef.current = true;
    latestValueRef.current = rawMarkdown;
    lastSyncedValueRef.current = rawMarkdown;
    onChangeRef.current(rawMarkdown);
  }, []);

  const handleMarkdownApplied = useCallback(() => {
    if (!sourceApplyPendingRef.current) return;
    sourceApplyPendingRef.current = false;
  }, []);

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      const attachments = files.filter((file) => !isImageUploadFile(file));
      if (
        !onUploadFiles ||
        readOnly ||
        uploadingFiles ||
        attachments.length === 0
      ) {
        return;
      }
      const returnToSource =
        modeRef.current === "source" || restoreSourceAfterUploadRef.current;
      restoreSourceAfterUploadRef.current = returnToSource;
      if (returnToSource) modeChangeRef.current?.("wysiwyg");
      setUploadingFiles(true);
      setUploadError(false);
      try {
        const result = await onUploadFiles(attachments);
        if (result.failed > 0 || result.cancelled > 0) setUploadError(true);
      } catch {
        setUploadError(true);
      } finally {
        setUploadingFiles(false);
      }
    },
    [onUploadFiles, readOnly, uploadingFiles],
  );

  useEffect(() => {
    if (uploadingFiles || !restoreSourceAfterUploadRef.current) return;
    restoreSourceAfterUploadRef.current = false;
    modeChangeRef.current?.("source");
  }, [uploadingFiles]);

  const handleUnsupportedImageUpload = useCallback(() => {
    setUploadError(true);
  }, []);
  const handleSurfacePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const files = filesFromFileList(event.clipboardData.files).filter(
        (file) => !isImageUploadFile(file),
      );
      if (!files.length || !onUploadFiles || readOnly) return;
      event.preventDefault();
      void handleUploadFiles(files);
    },
    [handleUploadFiles, onUploadFiles, readOnly],
  );
  const handleSurfaceDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const files = filesFromFileList(event.dataTransfer.files).filter(
        (file) => !isImageUploadFile(file),
      );
      if (!files.length || !onUploadFiles || readOnly) return;
      event.preventDefault();
      void handleUploadFiles(files);
    },
    [handleUploadFiles, onUploadFiles, readOnly],
  );
  const handleSurfaceDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const files = filesFromFileList(event.dataTransfer.files);
      const hasNonImageFile = files.some((file) => !isImageUploadFile(file));
      const hasNonImageItem = Array.from(event.dataTransfer.items ?? []).some(
        (item) => item.kind === "file" && !item.type.startsWith("image/"),
      );
      if (onUploadFiles && !readOnly && (hasNonImageFile || hasNonImageItem)) {
        event.preventDefault();
      }
    },
    [onUploadFiles, readOnly],
  );

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
      );
    },
    [],
  );
  const handleSurfaceKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      openFocusedEditorLink(surface, event.nativeEvent, setExternalLinkHref);
    },
    [],
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
      );
    },
    [],
  );
  const handleUnavailableLinkAuxClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const surface = surfaceRef.current;
      if (surface)
        preventUnavailableEditorLinkBehavior(surface, event.nativeEvent);
    },
    [],
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
      linkSearchInputLabel: t("linkSearchInputLabel"),
      linkSearchInputPlaceholder: t("linkSearchInputPlaceholder"),
      resizeHandle: t("resizeHandle"),
      resizeHandleDescription: (values: {
        current: string;
        min: string;
        max: string;
      }) => t("resizeHandleDescription", values),
    }),
    [t],
  );
  const renderHeader = useCallback<
    NonNullable<MarkdownEditingSurfaceProps["renderHeader"]>
  >(
    ({ mode, onModeChange, disabled, toolbar }) => {
      modeRef.current = mode;
      modeChangeRef.current = onModeChange;
      if (!headerOutlet || readOnly) return null;
      return createPortal(
        <div
          data-testid="markdown-toolbar"
          className="flex items-start gap-1 border-b border-border-subtle px-2 py-1"
        >
          <div
            data-testid="markdown-toolbar-controls"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
          >
            {toolbar}
            {onUploadFiles ? (
              <MarkdownAttachmentPicker
                label={toolbarLabels.attachFile}
                disabled={uploadingFiles}
                onFiles={(files) => void handleUploadFiles(files)}
                onImageFiles={(files, selectFiles) => {
                  if (modeRef.current === "source") {
                    restoreSourceAfterUploadRef.current = false;
                    modeRef.current = "wysiwyg";
                    modeChangeRef.current?.("wysiwyg");
                  }
                  selectFiles(files);
                }}
                onUnsupportedImage={handleUnsupportedImageUpload}
              />
            ) : null}
          </div>
          <div data-testid="markdown-source-toggle" className="shrink-0">
            <Button
              type="button"
              variant={mode === "source" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={mode === "source"}
              disabled={disabled}
              onClick={() =>
                onModeChange(mode === "source" ? "wysiwyg" : "source")
              }
              className="h-8 px-2 text-xs font-mono"
              title={toolbarLabels.toggleSourceMode}
            >
              {toolbarLabels.source}
            </Button>
          </div>
        </div>,
        headerOutlet,
      );
    },
    [
      handleUploadFiles,
      handleUnsupportedImageUpload,
      headerOutlet,
      onUploadFiles,
      readOnly,
      toolbarLabels,
      uploadingFiles,
    ],
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
      <div ref={setHeaderOutlet} />

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
          isManual && "min-h-0 overflow-hidden",
        )}
        style={bodyFrameLayoutStyle}
      >
        <div
          data-testid="markdown-editor-scroll-viewport"
          className={cn(
            "min-w-0",
            isManual ? EDITOR_MANUAL_SCROLL_SURFACE_CLASS : EDITOR_BODY_SIZING,
          )}
        >
          <MarkdownEditingSurface
            editor={editor}
            markdown={value}
            sourceContextKey={surfaceSourceContextKey}
            profile="preserve"
            onSourceChange={handleSourceChange}
            onMarkdownApplied={handleMarkdownApplied}
            readOnly={readOnly}
            modeSwitchDisabled={readOnly}
            imageMenu={imageMenuOptions}
            imageUpload={imageUploadOptions}
            renderHeader={renderHeader}
            toolbar={
              <MarkdownToolbar
                editor={editor}
                className="reef-markdown-toolbar min-w-0 flex-1 bg-transparent px-0 py-0"
                link={{
                  normalizeUrl,
                  searchAdapter: vault
                    ? markdownResourceSearchAdapter
                    : undefined,
                  searchContext: vault ? { vault } : undefined,
                  searchLabels: {
                    inputLabel: toolbarLabels.linkSearchInputLabel,
                    inputPlaceholder: toolbarLabels.linkSearchInputPlaceholder,
                  },
                }}
              />
            }
            sourcePlaceholder={sourcePlaceholder ?? placeholder}
            sourceAriaLabel={ariaLabel}
            sourceClassName={cn(
              "w-full field-sizing-content rounded-sm bg-transparent px-3 py-2 text-sm font-mono focus:outline-none",
              isResizeAvailable ? "resize-none" : "resize-y",
              isManual
                ? EDITOR_MANUAL_SOURCE_CLASS
                : EDITOR_SOURCE_CONTENT_CLASS,
            )}
            className={cn(
              isManual &&
                "h-full min-h-0 [&>[data-markdown-mode-panel=wysiwyg]]:h-full [&>[data-markdown-mode-panel=source]]:h-full",
            )}
            onPasteCapture={handleSurfacePaste}
            onDropCapture={handleSurfaceDrop}
            onDragOverCapture={handleSurfaceDragOver}
          >
            <div
              ref={surfaceRef}
              className="relative min-w-0"
              onClickCapture={handleSurfaceClickCapture}
              onKeyDownCapture={handleSurfaceKeyDownCapture}
              onAuxClickCapture={handleUnavailableLinkAuxClickCapture}
              onContextMenuCapture={handleUnavailableLinkAuxClickCapture}
              onMouseDownCapture={handleSurfaceMouseDownCapture}
              onMouseUpCapture={handleSurfaceMouseUpCapture}
            >
              <MarkdownSurface
                editor={editor}
                editable={!readOnly}
                image={ISSUE_MARKDOWN_IMAGE_OPTIONS}
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
          </MarkdownEditingSurface>
        </div>

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
