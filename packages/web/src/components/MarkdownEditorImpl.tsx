"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
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
  Quote,
  SquareCode,
  Strikethrough,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/**
 * Shared height policy for both editor surfaces — the WYSIWYG body and the
 * Source textarea. The body starts at a 200px floor so an empty description
 * reads as a real authoring canvas instead of a cramped box: on the create
 * dialog the writing column would otherwise sit shorter than the metadata rail
 * beside it (the rail is taller than a 120px floor), inverting the intended
 * emphasis. Content grows from that floor up to a viewport-relative cap, then
 * scrolls inside the editor instead of stretching the surrounding sheet (issue
 * detail) or dialog (create) — so the relationship fields below stay in normal
 * flow and remain reachable by the scrolling container, does not clipped. The 200px
 * floor matches the clamp's short-window floor, so the editor does not starts below
 * its own minimum ceiling. The clamp adapts to the full-height detail slide-over
 * and the 88vh create dialog alike: 48vh keeps the rest of the form in view, and
 * a 560px ceiling caps the height on large monitors. (REEF-133)
 *
 * The dynamic wrapper's loading skeleton reserves this same 200px floor so the
 * lazy chunk swap does not shift the surrounding form. (REEF-220)
 */
export const EDITOR_BODY_SIZING =
  "min-h-[200px] max-h-[clamp(200px,48vh,560px)] overflow-y-auto [scrollbar-gutter:stable]";
export const EDITOR_BODY_FRAME_CLASS = "p-1";
export const EDITOR_CONTENT_CLASS = "reef-markdown-editor";

export interface MarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
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
}

/** Active-state flags for every toolbar control, derived from the selection. */
interface ActiveMarks {
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

const NO_ACTIVE: ActiveMarks = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  h1: false,
  h2: false,
  h3: false,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  codeBlock: false,
  link: false,
};

export function createMarkdownEditorExtensions(placeholder: string) {
  return [
    // StarterKit v3 bundles the Link extension; configure it here rather than
    // registering a second @tiptap/extension-link (which warns about a
    // duplicate 'link' extension and leaves link behavior ambiguous).
    StarterKit.configure({ link: { openOnClick: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown,
    Placeholder.configure({ placeholder }),
  ];
}

function sameActive(a: ActiveMarks | null, b: ActiveMarks | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (Object.keys(a) as (keyof ActiveMarks)[]).every((k) => a[k] === b[k]);
}

/**
 * Normalize a user-typed link target. Returns null for empty input so the
 * caller can leave the current selection untouched (no link applied). Bare
 * domains gain an https:// scheme; anchors, absolute paths, mailto, and
 * explicit http(s) URLs pass through unchanged.
 */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^(https?:\/\/|mailto:|\/|#)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** A single uniform icon control in the editor toolbar. */
function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  isActive = false,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isActive}
      aria-label={label}
      title={label}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        isActive && "bg-surface-hover text-brand hover:text-brand",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </Button>
  );
}

/** Hairline separator between toolbar control groups. */
function ToolbarDivider() {
  return <Separator orientation="vertical" className="mx-0.5 h-4" />;
}

/**
 * WYSIWYG markdown editor backed by Tiptap.
 *
 * Uses @tiptap/markdown extension so content is stored/emitted as markdown
 * strings. Source-mode toggle lets the PM edit raw markdown directly.
 *
 * External `value` changes are synced back into the editor without moving
 * the cursor (preserveWhitespace + equality guard).
 *
 * This implementation module carries the TipTap/ProseMirror dependency. It is
 * loaded through the `next/dynamic` wrapper in `./MarkdownEditor` so those deps
 * land in a lazy chunk instead of the dashboard's initial bundle. (REEF-220)
 *
 * API notes (Tiptap v3 + @tiptap/markdown v3):
 * - Markdown content via: editor.getMarkdown() (augmented on Editor interface)
 * - setContent: editor.commands.setContent(content, options?) — 2 args
 * - Toolbar active states are read via useEditorState so the toolbar
 *   re-renders when the selection changes — not the whole editor on every key.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Describe the issue…",
  className,
  readOnly = false,
  ariaLabel,
  onBlur,
}: MarkdownEditorProps) {
  const t = useTranslations("markdownEditor");
  const c = useTranslations("common");
  const [sourceMode, setSourceMode] = useState(false);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const latestValueRef = useRef(value);

  const editor = useEditor({
    // Tiptap v3 requires this explicit opt-out under Next.js to avoid an SSR
    // hydration mismatch — the editor mounts on the client just.
    immediatelyRender: false,
    extensions: createMarkdownEditorExtensions(placeholder),
    content: value,
    contentType: "markdown",
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: cn(
          EDITOR_CONTENT_CLASS,
          "prose prose-sm dark:prose-invert focus:outline-none",
          EDITOR_BODY_SIZING,
          "px-3 py-2 max-w-none",
        ),
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      },
    },
    onUpdate: ({ editor: ed }) => {
      const markdown = ed.getMarkdown();
      latestValueRef.current = markdown;
      onChange(markdown);
    },
  });

  // Subscribe to derived active-state booleans just, so the toolbar re-renders
  // when formatting under the cursor changes — not on every transaction. The
  // explicit equality check keeps the reference stable until a flag flips.
  const active =
    useEditorState({
      editor,
      selector: ({ editor: ed }): ActiveMarks =>
        ed
          ? {
              bold: ed.isActive("bold"),
              italic: ed.isActive("italic"),
              strike: ed.isActive("strike"),
              code: ed.isActive("code"),
              h1: ed.isActive("heading", { level: 1 }),
              h2: ed.isActive("heading", { level: 2 }),
              h3: ed.isActive("heading", { level: 3 }),
              bulletList: ed.isActive("bulletList"),
              orderedList: ed.isActive("orderedList"),
              blockquote: ed.isActive("blockquote"),
              codeBlock: ed.isActive("codeBlock"),
              link: ed.isActive("link"),
            }
          : NO_ACTIVE,
      equalityFn: sameActive,
    }) ?? NO_ACTIVE;

  // Sync external value changes without moving the cursor
  useEffect(() => {
    latestValueRef.current = value;
    if (!editor) return;
    const current = editor.getMarkdown();
    if (value !== current) {
      // contentType: 'markdown' is required so the @tiptap/markdown extension parses the
      // string through marked; without it, Tiptap treats input as HTML and raw markdown
      // shows up as plain text. emitUpdate: false avoids retriggering onChange.
      editor.commands.setContent(value, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }
  }, [value, editor]);

  // Tiptap captures `editable` at creation and ignores later option changes, so
  // a readOnly toggle after mount (e.g. a save-pending lock) should be applied
  // imperatively. Without this the editor stays editable while a save is in
  // flight and edits made during the round-trip are silently dropped when the
  // dialog closes. `editor.isEditable === readOnly` is true when the two
  // disagree (isEditable should be `!readOnly`). The `false` second arg is
  // emitUpdate=false: flipping editability is not a content change, so it should
  // NOT fire onUpdate (which would push a no-op normalized value via onChange).
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable === readOnly) {
      editor.setEditable(!readOnly, false);
    }
  }, [editor, readOnly]);

  // Source mode textarea handler
  function handleSourceChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = e.target.value;
    latestValueRef.current = newValue;
    onChange(newValue);
    if (editor) {
      editor.commands.setContent(newValue, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }
  }

  function closeLinkEditor() {
    setLinkEditorOpen(false);
    setLinkUrl("");
  }

  function openLinkEditor() {
    if (!editor) return;
    const href =
      (editor.getAttributes("link").href as string | undefined) ?? "";
    setLinkUrl(href);
    setLinkEditorOpen(true);
  }

  function applyLink() {
    if (!editor) return;
    const href = normalizeUrl(linkUrl);
    // Empty/invalid input: apply nothing and keep the current selection.
    if (!href) {
      closeLinkEditor();
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !active.link) {
      // No selection and not on an existing link: insert the URL as its own
      // linked text so the result is still a real markdown link.
      chain.insertContent({
        type: "text",
        text: href,
        marks: [{ type: "link", attrs: { href } }],
      });
    } else {
      chain.setLink({ href });
    }
    chain.run();
    closeLinkEditor();
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    closeLinkEditor();
  }

  function toggleSourceMode() {
    setSourceMode((s) => {
      // Leaving WYSIWYG closes any open link editor so it does not linger over the
      // raw-markdown textarea where its commands wouldn't apply.
      if (!s) closeLinkEditor();
      return !s;
    });
  }

  const showLinkEditor = linkEditorOpen && !sourceMode && !readOnly;

  return (
    <div
      data-testid="markdown-editor"
      onBlur={(e) => {
        // fire when focus truly exits the editor subtree (toolbar +
        // content) — relatedTarget still inside means an internal focus shift.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          onBlur?.(latestValueRef.current);
        }
      }}
      className={`rounded-md border border-border bg-elevated transition-colors duration-150 focus-within:border-brand focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand/30 ${className ?? ""}`}
    >
      {/* Toolbar */}
      {!readOnly && (
        <div
          data-testid="markdown-toolbar"
          className="flex items-start gap-1 border-b border-border-subtle px-2 py-1"
        >
          <div
            data-testid="markdown-toolbar-controls"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
          >
            {/* Inline marks */}
            <div className="flex items-center gap-0.5">
              <ToolbarButton
                icon={Bold}
                label={t("bold")}
                isActive={active.bold}
                disabled={sourceMode}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              />
              <ToolbarButton
                icon={Italic}
                label={t("italic")}
                isActive={active.italic}
                disabled={sourceMode}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              />
              <ToolbarButton
                icon={Strikethrough}
                label={t("strikethrough")}
                isActive={active.strike}
                disabled={sourceMode}
                onClick={() => editor?.chain().focus().toggleStrike().run()}
              />
              <ToolbarButton
                icon={Code}
                label={t("inlineCode")}
                isActive={active.code}
                disabled={sourceMode}
                onClick={() => editor?.chain().focus().toggleCode().run()}
              />
            </div>

            <ToolbarDivider />

            {/* Headings */}
            <div className="flex items-center gap-0.5">
              <ToolbarButton
                icon={Heading1}
                label={t("heading1")}
                isActive={active.h1}
                disabled={sourceMode}
                onClick={() =>
                  editor?.chain().focus().toggleHeading({ level: 1 }).run()
                }
              />
              <ToolbarButton
                icon={Heading2}
                label={t("heading2")}
                isActive={active.h2}
                disabled={sourceMode}
                onClick={() =>
                  editor?.chain().focus().toggleHeading({ level: 2 }).run()
                }
              />
              <ToolbarButton
                icon={Heading3}
                label={t("heading3")}
                isActive={active.h3}
                disabled={sourceMode}
                onClick={() =>
                  editor?.chain().focus().toggleHeading({ level: 3 }).run()
                }
              />
            </div>

            <ToolbarDivider />

            {/* Lists */}
            <div className="flex items-center gap-0.5">
              <ToolbarButton
                icon={List}
                label={t("bulletList")}
                isActive={active.bulletList}
                disabled={sourceMode}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              />
              <ToolbarButton
                icon={ListOrdered}
                label={t("numberedList")}
                isActive={active.orderedList}
                disabled={sourceMode}
                onClick={() =>
                  editor?.chain().focus().toggleOrderedList().run()
                }
              />
            </div>

            <ToolbarDivider />

            {/* Blocks */}
            <div className="flex items-center gap-0.5">
              <ToolbarButton
                icon={Quote}
                label={t("quote")}
                isActive={active.blockquote}
                disabled={sourceMode}
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              />
              <ToolbarButton
                icon={SquareCode}
                label={t("codeBlock")}
                isActive={active.codeBlock}
                disabled={sourceMode}
                onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
              />
              <ToolbarButton
                icon={Minus}
                label={t("divider")}
                disabled={sourceMode}
                onClick={() =>
                  editor?.chain().focus().setHorizontalRule().run()
                }
              />
            </div>

            <ToolbarDivider />

            {/* Insert */}
            <div className="flex items-center gap-0.5">
              <ToolbarButton
                icon={LinkIcon}
                label={t("link")}
                isActive={active.link || linkEditorOpen}
                disabled={sourceMode}
                onClick={() =>
                  linkEditorOpen ? closeLinkEditor() : openLinkEditor()
                }
              />
            </div>
          </div>

          {/* Mode toggle */}
          <div data-testid="markdown-source-toggle" className="shrink-0">
            <Button
              type="button"
              variant={sourceMode ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={sourceMode}
              onClick={toggleSourceMode}
              className="h-7 px-2 text-xs font-mono"
              title={t("toggleSourceMode")}
            >
              {t("source")}
            </Button>
          </div>
        </div>
      )}

      {/* Link editor row — in-flow (not portaled) so it stays clickable inside
          modal dialogs that set body pointer-events:none. */}
      {showLinkEditor && (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-2 py-1.5"
          data-testid="markdown-link-editor"
        >
          <Input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Prevent submitting the surrounding issue form.
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeLinkEditor();
              }
            }}
            placeholder="https://example.com" // i18n-exempt: example URL placeholder
            aria-label={t("linkUrl")}
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
            onClick={applyLink}
            className="h-7 px-2 text-xs"
          >
            {t("apply")}
          </Button>
          {active.link && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeLink}
              className="h-7 px-2 text-xs"
            >
              {c("remove")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={closeLinkEditor}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            {c("cancel")}
          </Button>
        </div>
      )}

      <div
        data-testid="markdown-editor-body-frame"
        className={EDITOR_BODY_FRAME_CLASS}
      >
        {/* Editor area */}
        {sourceMode ? (
          <textarea
            value={value}
            onChange={handleSourceChange}
            readOnly={readOnly}
            aria-label={ariaLabel}
            // field-sizing-content auto-grows with the body where supported;
            // resize-y blocks horizontal drag (no dialog/sheet width overflow) and
            // stays a manual vertical fallback where field-sizing is unavailable,
            // so the textarea is does not stuck at min-h on those browsers.
            className={`w-full field-sizing-content resize-y rounded-sm ${EDITOR_BODY_SIZING} bg-transparent px-3 py-2 text-sm font-mono focus:outline-none`}
            placeholder={placeholder}
            data-testid="markdown-source-textarea"
          />
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
    </div>
  );
}
