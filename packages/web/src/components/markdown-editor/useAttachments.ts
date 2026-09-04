import {
  appendMarkdownSnippets,
  filesFromFileList,
  type AttachmentMarkdownUploadResult,
} from "@/features/issues/lib/attachmentMarkdown";
import type { ChangeEvent, ClipboardEvent, DragEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface MutableRef<T> {
  current: T;
}

export interface UseMarkdownEditorAttachmentsParams {
  rootRef: MutableRef<HTMLDivElement | null>;
  readOnly: boolean;
  onUploadFiles?: (files: File[]) => Promise<AttachmentMarkdownUploadResult[]>;
  getCurrentMarkdown: () => string;
  applyMarkdown: (markdown: string) => void;
  syncMarkdown: (markdown: string) => void;
  blurLatestMarkdown: (markdown: string) => void;
}

export interface MarkdownEditorAttachments {
  fileInputRef: MutableRef<HTMLInputElement | null>;
  uploadFilesRef: MutableRef<
    ((files: File[]) => Promise<AttachmentMarkdownUploadResult[]>) | undefined
  >;
  readOnlyRef: MutableRef<boolean>;
  uploadingFiles: boolean;
  uploadError: boolean;
  openFilePicker: () => void;
  handleInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleSourcePaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  handleSourceDrop: (event: DragEvent<HTMLTextAreaElement>) => void;
  handleEditorPaste: (event: globalThis.ClipboardEvent) => boolean;
  handleEditorDrop: (event: globalThis.DragEvent) => boolean;
}

export function useMarkdownEditorAttachments({
  rootRef,
  readOnly,
  onUploadFiles,
  getCurrentMarkdown,
  applyMarkdown,
  syncMarkdown,
  blurLatestMarkdown,
}: UseMarkdownEditorAttachmentsParams): MarkdownEditorAttachments {
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFilesRef = useRef(onUploadFiles);
  const readOnlyRef = useRef(readOnly);

  useEffect(() => {
    uploadFilesRef.current = onUploadFiles;
  }, [onUploadFiles]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  const appendUploadedMarkdown = useCallback(
    (snippets: readonly string[]) => {
      const current = getCurrentMarkdown();
      const next = appendMarkdownSnippets(current, snippets);
      if (next === current) return;
      applyMarkdown(next);
      syncMarkdown(next);
      // The native file picker can move focus outside the editor before the
      // asynchronous upload finishes. In that case the ordinary blur commit
      // has already saved the pre-upload body, so commit the completed insertion
      // now.
      if (!rootRef.current?.contains(document.activeElement)) {
        blurLatestMarkdown(next);
      }
    },
    [
      applyMarkdown,
      blurLatestMarkdown,
      getCurrentMarkdown,
      rootRef,
      syncMarkdown,
    ],
  );

  const uploadAndAppendFiles = useCallback(
    async (files: File[]) => {
      const uploadFiles = uploadFilesRef.current;
      if (!uploadFiles || readOnlyRef.current) return;
      setUploadingFiles(true);
      setUploadError(false);
      try {
        const results = await uploadFiles(files);
        appendUploadedMarkdown(
          results
            .map((result) => result.markdown)
            .filter((markdown): markdown is string => !!markdown),
        );
      } catch {
        setUploadError(true);
      } finally {
        setUploadingFiles(false);
      }
    },
    [appendUploadedMarkdown],
  );

  const openFilePicker = useCallback(() => {
    if (uploadingFiles || !uploadFilesRef.current || readOnlyRef.current) {
      return;
    }
    fileInputRef.current?.click();
  }, [uploadingFiles]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = filesFromFileList(event.currentTarget.files);
      event.currentTarget.value = "";
      if (files.length === 0) return;
      void uploadAndAppendFiles(files);
    },
    [uploadAndAppendFiles],
  );

  const handleSourcePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = filesFromFileList(event.clipboardData.files);
      if (
        files.length === 0 ||
        !uploadFilesRef.current ||
        readOnlyRef.current
      ) {
        return;
      }
      event.preventDefault();
      void uploadAndAppendFiles(files);
    },
    [uploadAndAppendFiles],
  );

  const handleSourceDrop = useCallback(
    (event: DragEvent<HTMLTextAreaElement>) => {
      const files = filesFromFileList(event.dataTransfer.files);
      if (
        files.length === 0 ||
        !uploadFilesRef.current ||
        readOnlyRef.current
      ) {
        return;
      }
      event.preventDefault();
      void uploadAndAppendFiles(files);
    },
    [uploadAndAppendFiles],
  );

  const handleEditorPaste = useCallback(
    (event: globalThis.ClipboardEvent) => {
      const files = filesFromFileList(event.clipboardData?.files ?? null);
      if (
        files.length === 0 ||
        !uploadFilesRef.current ||
        readOnlyRef.current
      ) {
        return false;
      }
      event.preventDefault();
      void uploadAndAppendFiles(files);
      return true;
    },
    [uploadAndAppendFiles],
  );

  const handleEditorDrop = useCallback(
    (event: globalThis.DragEvent) => {
      const files = filesFromFileList(event.dataTransfer?.files ?? null);
      if (
        files.length === 0 ||
        !uploadFilesRef.current ||
        readOnlyRef.current
      ) {
        return false;
      }
      event.preventDefault();
      void uploadAndAppendFiles(files);
      return true;
    },
    [uploadAndAppendFiles],
  );

  return {
    fileInputRef,
    uploadFilesRef,
    readOnlyRef,
    uploadingFiles,
    uploadError,
    openFilePicker,
    handleInputChange,
    handleSourcePaste,
    handleSourceDrop,
    handleEditorPaste,
    handleEditorDrop,
  };
}
