"use client";

import { Skeleton } from "@/components/ui/skeleton";
import dynamic from "next/dynamic";
import type { MarkdownEditorProps } from "./markdown-editor/types";

/**
 * Code-split boundary for the markdown editor. (REEF-220)
 *
 * The TipTap/ProseMirror editor sits behind interactions (create dialog, issue
 * detail edit, planning edit, settings templates), away from first paint, yet
 * a static import chain (`DashboardShell → NewIssueDialog → IssueDraftFields →
 * MarkdownEditor`) used to pull `@tiptap/*` + `@tiptap/pm` into the dashboard's
 * initial bundle. Wrapping the single shared editor in `next/dynamic` here moves
 * those deps into a lazy chunk, so all callers code-split at once just by
 * importing `MarkdownEditor` from this module (their import paths are unchanged).
 *
 * `ssr: false` is natural: the editor is a client component that opts out of
 * SSR (`immediatelyRender: false`) already, so there is no server output to
 * preserve. The loading skeleton below holds the editor's height floor so the
 * surrounding form does not shift when the chunk arrives.
 */

/**
 * Placeholder shown while the editor chunk loads. Mirrors the editor's outer
 * shell and reserves either the opted-in 320px issue Description frame or the
 * existing 200px automatic floor, plus the inset body frame and toolbar strip.
 * The read-mode Planning table inline expand has no toolbar, so it over-reserves by
 * the toolbar height for a frame — an acceptable trade to keep
 * the primary authoring surfaces from shifting on load.
 */
function MarkdownEditorSkeleton({
  enableHeightResize = false,
}: Pick<MarkdownEditorProps, "enableHeightResize">) {
  const bodyHeight = enableHeightResize ? "min-h-[320px]" : "min-h-[200px]";

  return (
    <div
      aria-hidden="true"
      data-testid="markdown-editor-skeleton"
      className="rounded-md border border-border bg-surface-elevated"
    >
      <div className="flex items-center gap-1 border-b border-border-subtle px-2 py-1">
        <Skeleton className="h-7 w-32" />
      </div>
      <div className="p-1" data-testid="markdown-editor-skeleton-body-frame">
        <div className={`${bodyHeight} px-3 py-2`}>
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}

/**
 * Keep separate lazy boundaries for the two public height policies. Next's
 * dynamic loading component receives only its own load state, not the caller's
 * props, so selecting the boundary at this small wrapper is what lets the
 * opted-in issue surfaces reserve 320px while every other consumer keeps the
 * existing 200px skeleton.
 */
const ResizableMarkdownEditor = dynamic<MarkdownEditorProps>(
  () => import("./MarkdownEditorImpl").then((m) => m.MarkdownEditor),
  {
    ssr: false,
    loading: () => <MarkdownEditorSkeleton enableHeightResize />,
  },
);

const AutomaticMarkdownEditor = dynamic<MarkdownEditorProps>(
  () => import("./MarkdownEditorImpl").then((m) => m.MarkdownEditor),
  {
    ssr: false,
    loading: () => <MarkdownEditorSkeleton />,
  },
);

/**
 * Public markdown editor entry point. Keeps the `@/components/MarkdownEditor`
 * import path and `MarkdownEditor` name stable so every call site stays
 * unchanged while the heavy implementation loads lazily from
 * `./MarkdownEditorImpl`.
 */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const Editor = props.enableHeightResize
    ? ResizableMarkdownEditor
    : AutomaticMarkdownEditor;
  return <Editor {...props} />;
}
