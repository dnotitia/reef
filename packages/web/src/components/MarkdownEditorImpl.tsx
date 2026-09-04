"use client";

import { linkSafetyConfig } from "@/components/markdown/linkSafety";
import { retargetRenderedAkbDocumentLinks } from "@/lib/akb/markdownDocumentLinks";
import { cn } from "@/lib/utils";
import { useAkbWebUrl } from "@/providers/AkbWebUrlProvider";
import { EditorContent, useEditor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMarkdownEditorExtensions } from "./markdown-editor/extensions";
import {
  EDITOR_BODY_FRAME_CLASS,
  EDITOR_BODY_SIZING,
  EDITOR_CONTENT_CLASS,
  EDITOR_MANUAL_BODY_CLASS,
  EDITOR_MANUAL_SCROLL_SURFACE_CLASS,
  EDITOR_MANUAL_SOURCE_CLASS,
  EDITOR_RESIZABLE_BODY_ID,
  MARKDOWN_SURFACE_CLASS,
  useMarkdownEditorHeightResize,
} from "./markdown-editor/heightResize";
import {
  openClickedEditorLink,
  openEditorLinkOnMouseUp,
  openLinkWindow,
  preventEditorSelectionOnLinkMouseDown,
} from "./markdown-editor/links";
import { MarkdownEditorLinkEditor } from "./markdown-editor/LinkEditor";
import { MarkdownEditorResizeHandle } from "./markdown-editor/ResizeHandle";
import { MarkdownEditorToolbar } from "./markdown-editor/Toolbar";
import type { MarkdownEditorProps } from "./markdown-editor/types";
import { useMarkdownEditorBody } from "./markdown-editor/useBody";
import { useMarkdownEditorLinkEditor } from "./markdown-editor/useLinkEditor";
import { useMarkdownEditorSlashMessages } from "./markdown-editor/useSlashMessages";
import { useMarkdownEditorToolbarState } from "./markdown-editor/useToolbarState";
import { useOverlayOpenRegistration } from "./ui/overlayDismiss";

/**
 * WYSIWYG markdown editor backed by Tiptap. The implementation composes the
 * editor's responsibility modules; the public lazy boundary remains in
 * `./MarkdownEditor` so Tiptap and ProseMirror stay out of the initial bundle.
 */
export function MarkdownEditor({
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
  resolveImageSrc,
  resolveAttachmentHref,
  mentionConfig,
  enableHeightResize = false,
  preferredHeight,
  bodyFrameRef: externalBodyFrameRef,
}: MarkdownEditorProps) {
  const t = useTranslations("markdownEditor");
  const c = useTranslations("common");
  const akbWebBase = useAkbWebUrl();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const body = useMarkdownEditorBody({
    value,
    onChange,
    onBlur,
    vault,
    mentionConfig,
    rootRef,
    readOnly,
    onUploadFiles,
    resolveImageSrc,
    resolveAttachmentHref,
  });
  const {
    attachments,
    handleBlur,
    handleSourceChange,
    initialContent,
    mentionDocumentSearchRef,
    mentionIssuesRef,
    mentionMembersRef,
    publishMarkdown,
    resolveAttachmentHrefRef,
    resolveImageSrcRef,
    setEditor,
    syncExternalValue,
    syncMentionRoster,
  } = body;
  const [sourceMode, setSourceMode] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [externalLinkHref, setExternalLinkHref] = useState<string | null>(null);
  const mentionDismissRef = useRef<(() => void) | null>(null);
  const slashDismissRef = useRef<(() => void) | null>(null);
  const linksOpenedFromMouseUpRef = useRef(
    new WeakMap<HTMLAnchorElement, number>(),
  );
  const setBodyFrameRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (typeof externalBodyFrameRef === "function") {
        externalBodyFrameRef(element);
      } else if (externalBodyFrameRef) {
        externalBodyFrameRef.current = element;
      }
    },
    [externalBodyFrameRef],
  );
  const {
    isResizeAvailable: isHeightResizeAvailable,
    isManual: isManualHeight,
    isResizing: isHeightResizing,
    maxHeight: editorMaxHeight,
    currentHeight: editorCurrentHeight,
    bodyFrameStyle,
    onKeyDown: onHeightResizeKeyDown,
    onLostPointerCapture: onHeightResizeLostPointerCapture,
    onPointerCancel: onHeightResizePointerCancel,
    onPointerDown: onHeightResizePointerDown,
    onPointerMove: onHeightResizePointerMove,
    onPointerUp: onHeightResizePointerUp,
    refreshAutoHeight,
  } = useMarkdownEditorHeightResize(enableHeightResize, preferredHeight);

  const dismissMention = useCallback(() => {
    mentionDismissRef.current?.();
  }, []);

  const handleMentionOpenChange = useCallback(
    (open: boolean, dismiss?: () => void) => {
      mentionDismissRef.current = open ? (dismiss ?? null) : null;
      setMentionOpen(open);
    },
    [],
  );

  const dismissSlash = useCallback(() => {
    slashDismissRef.current?.();
  }, []);

  const handleSlashOpenChange = useCallback(
    (open: boolean, dismiss?: () => void) => {
      slashDismissRef.current = open ? (dismiss ?? null) : null;
      setSlashOpen(open);
    },
    [],
  );

  useOverlayOpenRegistration(
    Boolean(mentionConfig && mentionOpen),
    dismissMention,
  );
  useOverlayOpenRegistration(slashOpen, dismissSlash);

  const editorBodyClassName = cn(
    EDITOR_CONTENT_CLASS,
    MARKDOWN_SURFACE_CLASS,
    "prose prose-sm focus:outline-none",
    isManualHeight ? EDITOR_MANUAL_BODY_CLASS : EDITOR_BODY_SIZING,
    "px-3 py-2 max-w-none",
  );

  const slashMessages = useMarkdownEditorSlashMessages();

  /* eslint-disable react-hooks/refs -- Tiptap invokes these renderer callbacks after React render; refs preserve the latest resolvers without recreating the editor. */
  const editor = useEditor({
    // Tiptap v3 requires this explicit opt-out under Next.js to avoid an SSR
    // hydration mismatch — the editor mounts on the client just.
    immediatelyRender: false,
    extensions: createMarkdownEditorExtensions(
      placeholder,
      (src) => resolveImageSrcRef.current?.(src) ?? src,
      mentionConfig
        ? {
            membersRef: mentionMembersRef,
            issuesRef: mentionIssuesRef,
            searchDocumentsRef: mentionDocumentSearchRef,
            suggestionsLabel: mentionConfig.suggestionsLabel,
            mentionOptionLabel: mentionConfig.mentionOptionLabel,
            peopleSectionLabel: mentionConfig.peopleSectionLabel,
            issuesSectionLabel: mentionConfig.issuesSectionLabel,
            documentsSectionLabel: mentionConfig.documentsSectionLabel,
            issueOptionLabel: mentionConfig.issueOptionLabel,
            documentOptionLabel: mentionConfig.documentOptionLabel,
            documentSearchLoadingLabel:
              mentionConfig.documentSearchLoadingLabel,
            documentSearchErrorLabel: mentionConfig.documentSearchErrorLabel,
            documentSearchEmptyLabel: mentionConfig.documentSearchEmptyLabel,
            onOpenChange: handleMentionOpenChange,
          }
        : undefined,
      (href) => resolveAttachmentHrefRef.current?.(href),
      slashMessages,
      vault,
      handleSlashOpenChange,
      akbWebBase,
    ),
    content: initialContent,
    contentType: "markdown",
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: editorBodyClassName,
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        ...(mentionConfig
          ? { "aria-autocomplete": "list", "aria-expanded": "false" }
          : {}),
      },
      handleDOMEvents: {
        mousedown: (view, event) =>
          preventEditorSelectionOnLinkMouseDown(view.dom, event),
        mouseup: (view, event) =>
          openEditorLinkOnMouseUp(
            view.dom,
            event,
            linksOpenedFromMouseUpRef.current,
            setExternalLinkHref,
            akbWebBase,
          ),
      },
      handleClick: (view, _pos, event) =>
        openClickedEditorLink(
          view.dom,
          event,
          linksOpenedFromMouseUpRef.current,
          setExternalLinkHref,
          akbWebBase,
        ),
      handlePaste: (_view, event) => attachments.handleEditorPaste(event),
      handleDrop: (_view, event) => attachments.handleEditorDrop(event),
    },
    onUpdate: ({ editor: updatedEditor }) =>
      publishMarkdown(updatedEditor.getMarkdown(), updatedEditor),
  });
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    setEditor(editor);
  }, [editor, setEditor]);

  const active = useMarkdownEditorToolbarState(editor);
  const {
    isOpen: linkEditorOpen,
    url: linkUrl,
    setUrl: setLinkUrl,
    close: closeLinkEditor,
    rememberSelection: rememberLinkSelection,
    toggle: toggleLinkEditor,
    apply: applyLink,
    remove: removeLink,
    onKeyDown: onLinkEditorKeyDown,
  } = useMarkdownEditorLinkEditor(editor, active.link);

  useEffect(() => {
    syncExternalValue(editor, value);
    refreshAutoHeight();
  }, [editor, refreshAutoHeight, syncExternalValue, value]);

  useEffect(() => {
    syncMentionRoster(editor);
  }, [editor, syncMentionRoster]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const retarget = () => {
      retargetRenderedAkbDocumentLinks(root, akbWebBase);
    };
    retarget();

    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(retarget);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [akbWebBase]);

  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable === readOnly) {
      editor.setEditable(!readOnly, false);
    }
  }, [editor, readOnly]);

  const toggleSourceMode = useCallback(() => {
    setSourceMode((isSourceMode) => {
      // Leaving WYSIWYG closes any open link editor so it does not linger over
      // the raw-markdown textarea where its commands wouldn't apply.
      if (!isSourceMode) closeLinkEditor();
      return !isSourceMode;
    });
  }, [closeLinkEditor]);

  const toolbarLabels = useMemo(
    () => ({
      bold: t("bold"),
      italic: t("italic"),
      strikethrough: t("strikethrough"),
      inlineCode: t("inlineCode"),
      heading1: t("heading1"),
      heading2: t("heading2"),
      heading3: t("heading3"),
      bulletList: t("bulletList"),
      numberedList: t("numberedList"),
      quote: t("quote"),
      codeBlock: t("codeBlock"),
      divider: t("divider"),
      link: t("link"),
      attachFile: t("attachFile"),
      toggleSourceMode: t("toggleSourceMode"),
      source: t("source"),
    }),
    [t],
  );
  const linkEditorLabels = useMemo(
    () => ({
      linkUrl: t("linkUrl"),
      apply: t("apply"),
      remove: c("remove"),
      cancel: c("cancel"),
    }),
    [c, t],
  );
  const resizeLabels = useMemo(
    () => ({
      resizeHandle: t("resizeHandle"),
      resizeHandleDescription: (values: {
        current: string;
        min: string;
        max: string;
      }) => t("resizeHandleDescription", values),
    }),
    [t],
  );
  const showLinkEditor = linkEditorOpen && !sourceMode && !readOnly;

  return (
    <div
      ref={rootRef}
      data-testid="markdown-editor"
      onBlur={(event) => {
        // Fire when focus truly exits the editor subtree (toolbar + content) —
        // relatedTarget still inside means an internal focus shift.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          handleBlur();
        }
      }}
      className={`rounded-md border border-border bg-surface-elevated transition-colors duration-150 focus-within:border-brand-focus focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand-focus ${className ?? ""}`}
    >
      {!readOnly && (
        <MarkdownEditorToolbar
          editor={editor}
          active={active}
          sourceMode={sourceMode}
          linkEditorOpen={linkEditorOpen}
          canUpload={Boolean(onUploadFiles)}
          uploadingFiles={attachments.uploadingFiles}
          fileInputRef={attachments.fileInputRef}
          labels={toolbarLabels}
          onRememberLinkSelection={rememberLinkSelection}
          onToggleLinkEditor={toggleLinkEditor}
          onOpenAttachmentFilePicker={attachments.openFilePicker}
          onAttachmentInputChange={attachments.handleInputChange}
          onToggleSourceMode={toggleSourceMode}
        />
      )}

      {showLinkEditor && (
        <MarkdownEditorLinkEditor
          linkUrl={linkUrl}
          hasActiveLink={active.link}
          labels={linkEditorLabels}
          onChange={setLinkUrl}
          onKeyDown={onLinkEditorKeyDown}
          onApply={applyLink}
          onRemove={removeLink}
          onClose={closeLinkEditor}
        />
      )}

      {(attachments.uploadingFiles || attachments.uploadError) && (
        <div
          className="border-b border-border-subtle px-3 py-1.5 text-xs text-muted-foreground"
          role={attachments.uploadError ? "alert" : "status"}
        >
          {attachments.uploadError ? t("uploadError") : t("uploading")}
        </div>
      )}

      <div
        ref={setBodyFrameRef}
        id={enableHeightResize ? EDITOR_RESIZABLE_BODY_ID : undefined}
        data-testid="markdown-editor-body-frame"
        className={cn(
          EDITOR_BODY_FRAME_CLASS,
          enableHeightResize && isHeightResizeAvailable && "relative",
          isManualHeight && "min-h-0 overflow-hidden mr-1 mb-1",
        )}
        style={bodyFrameStyle}
      >
        {sourceMode ? (
          <textarea
            value={value}
            onChange={handleSourceChange}
            onPaste={attachments.handleSourcePaste}
            onDrop={attachments.handleSourceDrop}
            onDragOver={(event) => {
              if (
                attachments.uploadFilesRef.current &&
                !attachments.readOnlyRef.current
              ) {
                event.preventDefault();
              }
            }}
            readOnly={readOnly}
            aria-label={ariaLabel}
            // field-sizing-content auto-grows with the body where supported;
            // resize-y blocks horizontal drag and remains a manual vertical
            // fallback where field-sizing is unavailable.
            className={cn(
              "w-full field-sizing-content rounded-sm bg-transparent px-3 py-2 text-sm font-mono focus:outline-none",
              isHeightResizeAvailable ? "resize-none" : "resize-y",
              isManualHeight ? EDITOR_MANUAL_SOURCE_CLASS : EDITOR_BODY_SIZING,
            )}
            placeholder={sourcePlaceholder ?? placeholder}
            data-testid="markdown-source-textarea"
          />
        ) : (
          <EditorContent
            editor={editor}
            className={
              isManualHeight ? EDITOR_MANUAL_SCROLL_SURFACE_CLASS : undefined
            }
          />
        )}

        {enableHeightResize && isHeightResizeAvailable ? (
          <MarkdownEditorResizeHandle
            currentHeight={editorCurrentHeight}
            maxHeight={editorMaxHeight}
            isResizing={isHeightResizing}
            labels={resizeLabels}
            onKeyDown={onHeightResizeKeyDown}
            onPointerCancel={onHeightResizePointerCancel}
            onPointerDown={onHeightResizePointerDown}
            onPointerMove={onHeightResizePointerMove}
            onPointerUp={onHeightResizePointerUp}
            onLostPointerCapture={onHeightResizeLostPointerCapture}
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
