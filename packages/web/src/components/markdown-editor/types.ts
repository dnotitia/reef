import type { DocumentSearchHit, IssueListItem, VaultMember } from "@reef/core";
import type { Ref } from "react";
import type { AttachmentMarkdownUploadResult } from "@/features/issues/lib/attachmentMarkdown";
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
   * mutates markdown after this resolves, leaving it unchanged when an upload
   * fails instead of inserting a broken local link.
   */
  onUploadFiles?: (files: File[]) => Promise<AttachmentMarkdownUploadResult[]>;
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
