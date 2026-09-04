import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KeyboardEvent } from "react";

export interface MarkdownEditorLinkEditorLabels {
  linkUrl: string;
  apply: string;
  remove: string;
  cancel: string;
}

export interface MarkdownEditorLinkEditorProps {
  linkUrl: string;
  hasActiveLink: boolean;
  labels: MarkdownEditorLinkEditorLabels;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onApply: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export function MarkdownEditorLinkEditor({
  linkUrl,
  hasActiveLink,
  labels,
  onChange,
  onKeyDown,
  onApply,
  onRemove,
  onClose,
}: MarkdownEditorLinkEditorProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-2 py-1.5"
      data-testid="markdown-link-editor"
    >
      <Input
        value={linkUrl}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="https://example.com" // i18n-exempt: example URL placeholder
        aria-label={labels.linkUrl}
        data-testid="markdown-link-input"
        type="url"
        inputMode="url"
        name="link-url"
        autoComplete="off"
        spellCheck={false}
        // User-initiated single primary input that mounts on demand —
        // focusing it lets the PM type the URL without a second click.
        autoFocus
        className="h-7 flex-1 text-xs"
      />
      <Button
        type="button"
        variant="brand"
        size="sm"
        onClick={onApply}
        className="h-7 px-2 text-xs"
      >
        {labels.apply}
      </Button>
      {hasActiveLink && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-7 px-2 text-xs"
        >
          {labels.remove}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="h-7 px-2 text-xs text-muted-foreground"
      >
        {labels.cancel}
      </Button>
    </div>
  );
}
