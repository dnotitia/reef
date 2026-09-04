import { resolveAkbDocumentTitles } from "@/lib/akb/documentTitleResolver";
import {
  extractAkbDocumentUris,
  normalizeAkbDocumentMarkdownLinks,
} from "@/lib/akb/markdownDocumentLinks";
import type { VaultMember } from "@reef/core";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { syncEditorMarkdown } from "./content";

interface MutableRef<T> {
  current: T;
}

export interface UseMarkdownEditorDocumentTitlesParams {
  vault?: string;
  latestValueRef: MutableRef<string>;
  onChangeRef: MutableRef<(markdown: string) => void>;
  onBlurRef: MutableRef<((value: string) => void) | undefined>;
  editorRef: MutableRef<Editor | null>;
  rootRef: MutableRef<HTMLDivElement | null>;
  mentionMembersRef: MutableRef<readonly VaultMember[]>;
  mentionsEnabled: boolean;
}

export interface MarkdownEditorDocumentTitles {
  resolvedTitleMapRef: MutableRef<Map<string, string | null>>;
  normalizeMarkdown: (markdown: string) => string;
  queueResolution: (markdown: string, editor?: Editor | null) => void;
}

export function useMarkdownEditorDocumentTitles({
  vault,
  latestValueRef,
  onChangeRef,
  onBlurRef,
  editorRef,
  rootRef,
  mentionMembersRef,
  mentionsEnabled,
}: UseMarkdownEditorDocumentTitlesParams): MarkdownEditorDocumentTitles {
  const resolvedTitleMapRef = useRef(new Map<string, string | null>());
  const pendingTitleUrisRef = useRef(new Set<string>());
  const previousVaultRef = useRef(vault);

  useEffect(() => {
    if (previousVaultRef.current === vault) return;
    previousVaultRef.current = vault;
    resolvedTitleMapRef.current.clear();
    pendingTitleUrisRef.current.clear();
  }, [vault]);

  const normalizeMarkdown = useCallback(
    (markdown: string) =>
      normalizeAkbDocumentMarkdownLinks(markdown, resolvedTitleMapRef.current),
    [],
  );

  const queueResolution = useCallback(
    (markdown: string, editor?: Editor | null) => {
      if (!vault) return;
      const unresolved = extractAkbDocumentUris(markdown).filter(
        (uri) =>
          !resolvedTitleMapRef.current.has(uri) &&
          !pendingTitleUrisRef.current.has(uri),
      );
      if (unresolved.length === 0) return;

      for (const uri of unresolved) pendingTitleUrisRef.current.add(uri);
      void resolveAkbDocumentTitles(vault, unresolved).then((titles) => {
        for (const uri of unresolved) {
          pendingTitleUrisRef.current.delete(uri);
          resolvedTitleMapRef.current.set(uri, titles.get(uri) ?? null);
        }
        const next = normalizeMarkdown(latestValueRef.current);
        if (next === latestValueRef.current) return;
        latestValueRef.current = next;
        onChangeRef.current(next);
        syncEditorMarkdown(
          editor ?? editorRef.current,
          next,
          mentionsEnabled ? mentionMembersRef.current : undefined,
        );
        if (!rootRef.current?.contains(document.activeElement)) {
          onBlurRef.current?.(next);
        }
      });
    },
    [
      editorRef,
      latestValueRef,
      mentionMembersRef,
      mentionsEnabled,
      normalizeMarkdown,
      onBlurRef,
      onChangeRef,
      rootRef,
      vault,
    ],
  );

  return useMemo(
    () => ({ resolvedTitleMapRef, normalizeMarkdown, queueResolution }),
    [normalizeMarkdown, queueResolution],
  );
}
