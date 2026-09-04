import type { AttachmentMarkdownUploadResult } from "@/features/issues/lib/attachmentMarkdown";
import { restoreRenderedAkbDocumentMarkdownLinks } from "@/lib/akb/markdownDocumentLinks";
import type { IssueListItem, VaultMember } from "@reef/core";
import type { Editor } from "@tiptap/react";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useRef } from "react";
import {
  prepareIssueBodyMentionMarkdown,
  type IssueBodyDocumentSearch,
} from "../issueBodyMentionExtension";
import type { MarkdownEditorMentionConfig } from "./types";
import { setEditorMarkdown, syncEditorMarkdown } from "./content";
import {
  useMarkdownEditorAttachments,
  type MarkdownEditorAttachments,
} from "./useAttachments";
import { useMarkdownEditorDocumentTitles } from "./useDocumentTitles";

interface MutableRef<T> {
  current: T;
}

export interface UseMarkdownEditorBodyParams {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: (value: string) => void;
  vault?: string;
  mentionConfig?: MarkdownEditorMentionConfig;
  rootRef: MutableRef<HTMLDivElement | null>;
  readOnly: boolean;
  onUploadFiles?: (files: File[]) => Promise<AttachmentMarkdownUploadResult[]>;
  resolveImageSrc?: (src: string) => string;
  resolveAttachmentHref?: (href: string) => string;
}

export interface MarkdownEditorBody {
  resolveImageSrcRef: MutableRef<((src: string) => string) | undefined>;
  resolveAttachmentHrefRef: MutableRef<((href: string) => string) | undefined>;
  mentionMembersRef: MutableRef<readonly VaultMember[]>;
  mentionIssuesRef: MutableRef<readonly IssueListItem[]>;
  mentionDocumentSearchRef: MutableRef<IssueBodyDocumentSearch | undefined>;
  initialContent: string;
  attachments: MarkdownEditorAttachments;
  setEditor: (editor: Editor | null) => void;
  getLatestMarkdown: () => string;
  handleBlur: () => void;
  publishMarkdown: (rawMarkdown: string, editor?: Editor | null) => void;
  syncExternalValue: (editor: Editor | null, externalValue: string) => void;
  syncMentionRoster: (editor: Editor | null) => void;
  handleSourceChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}

export function useMarkdownEditorBody({
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
}: UseMarkdownEditorBodyParams): MarkdownEditorBody {
  const latestValueRef = useRef(value);
  const lastSyncedValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const resolveImageSrcRef = useRef(resolveImageSrc);
  const resolveAttachmentHrefRef = useRef(resolveAttachmentHref);
  const editorRef = useRef<Editor | null>(null);
  const mentionMembersRef = useRef<readonly VaultMember[]>([]);
  const mentionIssuesRef = useRef<readonly IssueListItem[]>([]);
  const mentionDocumentSearchRef = useRef<IssueBodyDocumentSearch | undefined>(
    undefined,
  );
  const previousMentionRosterRef = useRef<string | null>(null);

  useEffect(() => {
    mentionMembersRef.current = mentionConfig?.members ?? [];
    mentionIssuesRef.current = mentionConfig?.issues ?? [];
    mentionDocumentSearchRef.current = mentionConfig?.searchDocuments;
  }, [
    mentionConfig?.members,
    mentionConfig?.issues,
    mentionConfig?.searchDocuments,
  ]);

  useEffect(() => {
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
    resolveImageSrcRef.current = resolveImageSrc;
    resolveAttachmentHrefRef.current = resolveAttachmentHref;
  }, [onBlur, onChange, resolveAttachmentHref, resolveImageSrc]);

  const mentionsEnabled = Boolean(mentionConfig);
  const documentTitles = useMarkdownEditorDocumentTitles({
    vault,
    latestValueRef,
    onChangeRef,
    onBlurRef,
    editorRef,
    rootRef,
    mentionMembersRef,
    mentionsEnabled,
  });

  const getLatestMarkdown = useCallback(() => latestValueRef.current, []);

  const handleBlur = useCallback(() => {
    onBlurRef.current?.(latestValueRef.current);
  }, []);

  const syncMarkdown = useCallback(
    (markdown: string) => {
      syncEditorMarkdown(
        editorRef.current,
        markdown,
        mentionsEnabled ? mentionMembersRef.current : undefined,
      );
    },
    [mentionsEnabled],
  );

  const applyAttachmentMarkdown = useCallback((markdown: string) => {
    latestValueRef.current = markdown;
    onChangeRef.current(markdown);
  }, []);

  const blurLatestMarkdown = useCallback((markdown: string) => {
    onBlurRef.current?.(markdown);
  }, []);

  const attachments = useMarkdownEditorAttachments({
    rootRef,
    readOnly,
    onUploadFiles,
    getCurrentMarkdown: getLatestMarkdown,
    applyMarkdown: applyAttachmentMarkdown,
    syncMarkdown,
    blurLatestMarkdown,
  });

  const publishMarkdown = useCallback(
    (rawMarkdown: string, editor?: Editor | null) => {
      const restoredMarkdown = restoreRenderedAkbDocumentMarkdownLinks(
        rawMarkdown,
        rootRef.current,
      );
      const markdown = documentTitles.normalizeMarkdown(restoredMarkdown);
      const markdownChanged = markdown !== latestValueRef.current;
      latestValueRef.current = markdown;
      if (restoredMarkdown === rawMarkdown && markdown !== rawMarkdown) {
        syncEditorMarkdown(
          editor,
          markdown,
          mentionsEnabled ? mentionMembersRef.current : undefined,
        );
      }
      if (markdownChanged) onChangeRef.current(markdown);
      documentTitles.queueResolution(markdown, editor);
    },
    [documentTitles, mentionsEnabled, rootRef],
  );

  const syncExternalValue = useCallback(
    (editor: Editor | null, externalValue: string) => {
      const normalized = documentTitles.normalizeMarkdown(externalValue);
      const externalValueChanged = normalized !== lastSyncedValueRef.current;
      latestValueRef.current = normalized;
      if (normalized !== externalValue) onChangeRef.current(normalized);
      if (
        editor &&
        externalValueChanged &&
        normalized !== editor.getMarkdown()
      ) {
        setEditorMarkdown(
          editor,
          normalized,
          mentionsEnabled ? mentionMembersRef.current : undefined,
        );
      }
      lastSyncedValueRef.current = normalized;
      documentTitles.queueResolution(normalized, editor);
    },
    [documentTitles, mentionsEnabled],
  );

  const mentionRosterFingerprint = mentionConfig
    ? mentionConfig.members.map((member) => member.username).join("\u0000")
    : null;

  const syncMentionRoster = useCallback(
    (editor: Editor | null) => {
      if (!mentionConfig || !editor) return;
      if (previousMentionRosterRef.current === mentionRosterFingerprint) return;
      previousMentionRosterRef.current = mentionRosterFingerprint;

      const selection = editor.state.selection;
      const currentMarkdown = latestValueRef.current;
      setEditorMarkdown(editor, currentMarkdown, mentionMembersRef.current);
      const documentSize = editor.state.doc.content.size;
      if (documentSize > 0 && typeof selection.from === "number") {
        editor.commands.setTextSelection({
          from: Math.min(selection.from, documentSize),
          to: Math.min(selection.to, documentSize),
        });
      }
    },
    [mentionConfig, mentionRosterFingerprint],
  );

  const handleSourceChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = documentTitles.normalizeMarkdown(event.target.value);
      latestValueRef.current = newValue;
      onChangeRef.current(newValue);
      setEditorMarkdown(
        editorRef.current,
        newValue,
        mentionsEnabled ? mentionMembersRef.current : undefined,
      );
      documentTitles.queueResolution(newValue, editorRef.current);
    },
    [documentTitles, mentionsEnabled],
  );

  const setEditor = useCallback((editor: Editor | null) => {
    editorRef.current = editor;
  }, []);

  return {
    resolveImageSrcRef,
    resolveAttachmentHrefRef,
    mentionMembersRef,
    mentionIssuesRef,
    mentionDocumentSearchRef,
    initialContent: mentionConfig
      ? prepareIssueBodyMentionMarkdown(value, mentionConfig.members)
      : value,
    attachments,
    setEditor,
    getLatestMarkdown,
    handleBlur,
    publishMarkdown,
    syncExternalValue,
    syncMentionRoster,
    handleSourceChange,
  };
}
