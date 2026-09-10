import type {
  MarkdownAdapters,
  MarkdownTargetResolverContext,
  MarkdownUploadBatchResult,
} from "@akb/markdown-editor";
import type { DocumentSearchHit, IssueListItem, VaultMember } from "@reef/core";
import type { ChainedCommands, Editor, FocusPosition } from "@tiptap/core";
import type { Ref } from "react";
import type { IssueBodyDocumentSearch } from "../issueBodyMentionExtension";

export interface MarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  /** Placeholder rendered by the editable WYSIWYG surface. */
  placeholder?: string;
  /** Placeholder rendered by the raw Markdown Source textarea. */
  sourcePlaceholder?: string;
  className?: string;
  readOnly?: boolean;
  /**
   * Accessible name for the contenteditable region. The body lives in a
   * contenteditable (not a native form control), so it does not be associated via
   * `<label htmlFor>`; pass a name here to give screen readers a name without a
   * wrapping native control.
   */
  ariaLabel?: string;
  /**
   * Fires when focus leaves the editor entirely (not on internal focus shifts
   * between the toolbar and the content area). Lets callers commit on blur
   * without reverse-engineering the editor's focus boundary from outside.
   */
  onBlur?: (value: string) => void;
  /** Active AKB vault. Enables akb:// document title resolution when supplied. */
  vault?: string;
  /**
   * Optional file upload hook for issue-owned editor surfaces. The editor
   * mutates markdown after this resolves, inserting only successful attachment
   * items and leaving failed/cancelled items out of the document.
   */
  onUploadFiles?: (files: File[]) => Promise<MarkdownUploadBatchResult>;
  /** Common target resolver used for ephemeral WYSIWYG reference resolution. */
  adapters?: Pick<MarkdownAdapters, "targetResolver">;
  /** Source identity used by the common target resolver; never serialized. */
  resolverContext?: MarkdownTargetResolverContext;
  /** Resolve stored image URLs (for example akb:// file URIs) for WYSIWYG paint. */
  resolveImageSrc?: (src: string) => string;
  /** Resolve explicit AKB file links for the issue-scoped authenticated proxy. */
  resolveAttachmentHref?: (href: string) => string;
  /**
   * Enables issue-body member mentions. Omit this elsewhere so the
   * shared editor keeps its existing schema and interaction contract.
   */
  mentionConfig?: MarkdownEditorMentionConfig;
  /** Enables the issue-detail description height control when the input surface supports it. */
  enableHeightResize?: boolean;
  /**
   * A non-persistent height supplied by a containing layout (for example, a
   * maximized New Issue dialog). A larger preferred value may temporarily grow
   * a saved baseline, while explicit user resizing always wins and persists.
   */
  preferredHeight?: number;
  /** Optional observation seam for a containing layout's transient geometry. */
  bodyFrameRef?: Ref<HTMLDivElement>;
}

export interface MarkdownEditorMentionConfig {
  members: readonly VaultMember[];
  issues: readonly IssueListItem[];
  searchDocuments?: IssueBodyDocumentSearch;
  suggestionsLabel: string;
  mentionOptionLabel: (username: string) => string;
  peopleSectionLabel: string;
  issuesSectionLabel: string;
  documentsSectionLabel: string;
  issueOptionLabel: (issue: IssueListItem) => string;
  documentOptionLabel: (hit: DocumentSearchHit) => string;
  documentSearchLoadingLabel: string;
  documentSearchErrorLabel: string;
  documentSearchEmptyLabel: string;
}

/** Active-state flags for every toolbar control, derived from the selection. */
export interface ActiveMarks {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  h1: boolean;
  h2: boolean;
  h3: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  link: boolean;
}

export interface EditorSelectionRange {
  from: number;
  to: number;
}

/**
 * Commands are supplied by the shared extension set at runtime. The product
 * adapter keeps their chain type local so consumers do not need to import
 * every Tiptap command package just to augment `ChainedCommands`.
 */
export type MarkdownEditorChain = Omit<
  ChainedCommands,
  "deleteRange" | "extendMarkRange" | "focus" | "setTextSelection"
> & {
  deleteRange: (range: EditorSelectionRange) => MarkdownEditorChain;
  extendMarkRange: (
    typeOrName: string,
    attributes?: Record<string, unknown>,
  ) => MarkdownEditorChain;
  focus: (position?: FocusPosition) => MarkdownEditorChain;
  insertTable: (options: {
    cols: number;
    rows: number;
    withHeaderRow: boolean;
  }) => MarkdownEditorChain;
  setCodeBlock: () => MarkdownEditorChain;
  setHeading: (options: { level: 1 | 2 | 3 }) => MarkdownEditorChain;
  setHorizontalRule: () => MarkdownEditorChain;
  setLink: (attributes: { href: string }) => MarkdownEditorChain;
  setTextSelection: (
    position: number | EditorSelectionRange,
  ) => MarkdownEditorChain;
  toggleBlockquote: () => MarkdownEditorChain;
  toggleBold: () => MarkdownEditorChain;
  toggleBulletList: () => MarkdownEditorChain;
  toggleCode: () => MarkdownEditorChain;
  toggleCodeBlock: () => MarkdownEditorChain;
  toggleHeading: (options: { level: 1 | 2 | 3 }) => MarkdownEditorChain;
  toggleItalic: () => MarkdownEditorChain;
  toggleOrderedList: () => MarkdownEditorChain;
  toggleStrike: () => MarkdownEditorChain;
  toggleTaskList: () => MarkdownEditorChain;
  unsetLink: () => MarkdownEditorChain;
};

export function asMarkdownEditorChain(
  chain: ReturnType<Editor["chain"]>,
): MarkdownEditorChain {
  return chain as MarkdownEditorChain;
}
