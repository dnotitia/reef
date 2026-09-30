"use client";

import dynamic from "next/dynamic";
import { MarkdownEditorLoadingSkeleton } from "./markdown-editor/MarkdownEditorLoadingSkeleton";
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
 * preserve. The shared loading skeleton reads the same tab-local sizing policy
 * as the editor and mirrors its toolbar so the surrounding form does not shift
 * when the chunk arrives.
 */

/**
 * Keep separate lazy boundaries for the two public height policies. Next's
 * dynamic loading component receives its own load state, not the caller's
 * props, so selecting the boundary at this small wrapper is what lets the
 * opted-in issue surfaces restore the saved Description height while every
 * other consumer keeps the existing 200px automatic floor.
 */
const ResizableMarkdownEditor = dynamic<MarkdownEditorProps>(
  () => import("./MarkdownEditorImpl").then((m) => m.MarkdownEditor),
  {
    ssr: false,
    loading: () => <MarkdownEditorLoadingSkeleton enableHeightResize />,
  },
);

const AutomaticMarkdownEditor = dynamic<MarkdownEditorProps>(
  () => import("./MarkdownEditorImpl").then((m) => m.MarkdownEditor),
  {
    ssr: false,
    loading: () => <MarkdownEditorLoadingSkeleton />,
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
