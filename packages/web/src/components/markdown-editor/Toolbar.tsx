import { cn } from "@/lib/utils";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  Paperclip,
  Quote,
  SquareCode,
  Strikethrough,
} from "lucide-react";
import type { ChangeEventHandler, RefObject } from "react";
import { Button } from "@/components/ui/button";
import type { ActiveMarks } from "./types";

interface ToolbarButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  onPressStart?: () => void;
  isActive?: boolean;
  disabled?: boolean;
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  onPressStart,
  isActive = false,
  disabled = false,
}: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      onMouseDown={(event) => {
        event.preventDefault();
        onPressStart?.();
      }}
      disabled={disabled}
      aria-pressed={isActive}
      aria-label={label}
      title={label}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        isActive && "bg-surface-hover text-brand-text hover:text-brand-text",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </Button>
  );
}

function ToolbarDivider() {
  return (
    <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
  );
}

export interface MarkdownEditorToolbarLabels {
  bold: string;
  italic: string;
  strikethrough: string;
  inlineCode: string;
  heading1: string;
  heading2: string;
  heading3: string;
  bulletList: string;
  numberedList: string;
  quote: string;
  codeBlock: string;
  divider: string;
  link: string;
  attachFile: string;
  toggleSourceMode: string;
  source: string;
}

export interface MarkdownEditorToolbarProps {
  editor: Editor | null;
  active: ActiveMarks;
  sourceMode: boolean;
  linkEditorOpen: boolean;
  canUpload: boolean;
  uploadingFiles: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  labels: MarkdownEditorToolbarLabels;
  onRememberLinkSelection: () => void;
  onToggleLinkEditor: () => void;
  onOpenAttachmentFilePicker: () => void;
  onAttachmentInputChange: ChangeEventHandler<HTMLInputElement>;
  onToggleSourceMode: () => void;
}

export function MarkdownEditorToolbar({
  editor,
  active,
  sourceMode,
  linkEditorOpen,
  canUpload,
  uploadingFiles,
  fileInputRef,
  labels,
  onRememberLinkSelection,
  onToggleLinkEditor,
  onOpenAttachmentFilePicker,
  onAttachmentInputChange,
  onToggleSourceMode,
}: MarkdownEditorToolbarProps) {
  return (
    <div
      data-testid="markdown-toolbar"
      className="flex items-start gap-1 border-b border-border-subtle px-2 py-1"
    >
      <div
        data-testid="markdown-toolbar-controls"
        className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
      >
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            icon={Bold}
            label={labels.bold}
            isActive={active.bold}
            disabled={sourceMode}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            icon={Italic}
            label={labels.italic}
            isActive={active.italic}
            disabled={sourceMode}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            icon={Strikethrough}
            label={labels.strikethrough}
            isActive={active.strike}
            disabled={sourceMode}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          />
          <ToolbarButton
            icon={Code}
            label={labels.inlineCode}
            isActive={active.code}
            disabled={sourceMode}
            onClick={() => editor?.chain().focus().toggleCode().run()}
          />
        </div>

        <ToolbarDivider />

        <div className="flex items-center gap-0.5">
          <ToolbarButton
            icon={Heading1}
            label={labels.heading1}
            isActive={active.h1}
            disabled={sourceMode}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 1 }).run()
            }
          />
          <ToolbarButton
            icon={Heading2}
            label={labels.heading2}
            isActive={active.h2}
            disabled={sourceMode}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          />
          <ToolbarButton
            icon={Heading3}
            label={labels.heading3}
            isActive={active.h3}
            disabled={sourceMode}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 3 }).run()
            }
          />
        </div>

        <ToolbarDivider />

        <div className="flex items-center gap-0.5">
          <ToolbarButton
            icon={List}
            label={labels.bulletList}
            isActive={active.bulletList}
            disabled={sourceMode}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            icon={ListOrdered}
            label={labels.numberedList}
            isActive={active.orderedList}
            disabled={sourceMode}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          />
        </div>

        <ToolbarDivider />

        <div className="flex items-center gap-0.5">
          <ToolbarButton
            icon={Quote}
            label={labels.quote}
            isActive={active.blockquote}
            disabled={sourceMode}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          />
          <ToolbarButton
            icon={SquareCode}
            label={labels.codeBlock}
            isActive={active.codeBlock}
            disabled={sourceMode}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          />
          <ToolbarButton
            icon={Minus}
            label={labels.divider}
            disabled={sourceMode}
            onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          />
        </div>

        <ToolbarDivider />

        <div className="flex items-center gap-0.5">
          <ToolbarButton
            icon={LinkIcon}
            label={labels.link}
            isActive={active.link || linkEditorOpen}
            disabled={sourceMode}
            onPressStart={onRememberLinkSelection}
            onClick={onToggleLinkEditor}
          />
          {canUpload && (
            <>
              <ToolbarButton
                icon={Paperclip}
                label={labels.attachFile}
                disabled={uploadingFiles}
                onClick={onOpenAttachmentFilePicker}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                aria-label={labels.attachFile}
                data-testid="markdown-attachment-input"
                onChange={onAttachmentInputChange}
              />
            </>
          )}
        </div>
      </div>

      <div data-testid="markdown-source-toggle" className="shrink-0">
        <Button
          type="button"
          variant={sourceMode ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={sourceMode}
          onClick={onToggleSourceMode}
          className="h-7 px-2 text-xs font-mono"
          title={labels.toggleSourceMode}
        >
          {labels.source}
        </Button>
      </div>
    </div>
  );
}
