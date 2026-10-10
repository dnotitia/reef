import type {
  MarkdownAdapters,
  MarkdownSearchAdapter,
  MarkdownTargetResolverContext,
  MarkdownUploadBatchResult,
} from "@akb/markdown-editor";
import type { MarkdownImageUploadOptions } from "@akb/markdown-editor/react";
import type { IssueListItem, VaultMember } from "@reef/core";
import type { Ref } from "react";

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
   * Optional upload hook for non-image attachments. Images use the shared
   * Markdown image upload surface so insertion and replacement retain their
   * selected editor position.
   */
  onUploadFiles?: (files: File[]) => Promise<MarkdownUploadBatchResult>;
  /** Product-owned image storage and retention policy for the shared surface. */
  imageUpload?: MarkdownImageUploadOptions;
  /** Common target resolver used for ephemeral WYSIWYG reference resolution. */
  adapters?: Pick<MarkdownAdapters, "targetResolver">;
  /** Source identity used by the common target resolver; is not serialized. */
  resolverContext?: MarkdownTargetResolverContext;
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
   * a saved baseline, while explicit user resizing takes precedence and persists.
   */
  preferredHeight?: number;
  /** Optional observation seam for a containing layout's transient geometry. */
  bodyFrameRef?: Ref<HTMLDivElement>;
}

export interface MarkdownEditorMentionConfig {
  members: readonly VaultMember[];
  issues: readonly IssueListItem[];
  searchAdapter?: MarkdownSearchAdapter;
  mentionOptionLabel: (username: string) => string;
}
