"use client";

import { Skeleton } from "@/components/ui/skeleton";
import dynamic from "next/dynamic";
import type { MarkdownEditorProps } from "./MarkdownEditorImpl";

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
 * shell and reserves the 200px body floor (EDITOR_BODY_SIZING) plus a toolbar
 * strip, matching the editable surfaces that dominate the call sites. The
 * read-mode Planning table inline expand has no toolbar, so it over-reserves by
 * the toolbar height for a frame — an acceptable trade to keep
 * the primary authoring surfaces from shifting on load.
 */
function MarkdownEditorSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-testid="markdown-editor-skeleton"
      className="rounded-md border border-border bg-elevated"
    >
      <div className="flex items-center gap-1 border-b border-border-subtle px-2 py-1">
        <Skeleton className="h-7 w-32" />
      </div>
      <div className="min-h-[200px] px-3 py-2">
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

/**
 * Public markdown editor entry point. Keeps the `@/components/MarkdownEditor`
 * import path and `MarkdownEditor` name stable so every call site stays
 * unchanged while the heavy implementation loads lazily from
 * `./MarkdownEditorImpl`.
 */
export const MarkdownEditor = dynamic<MarkdownEditorProps>(
  () => import("./MarkdownEditorImpl").then((m) => m.MarkdownEditor),
  { ssr: false, loading: () => <MarkdownEditorSkeleton /> },
);
