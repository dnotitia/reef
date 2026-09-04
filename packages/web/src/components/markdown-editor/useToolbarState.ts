import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import type { ActiveMarks } from "./types";

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

function sameActive(
  first: ActiveMarks | null,
  second: ActiveMarks | null,
): boolean {
  if (first === second) return true;
  if (!first || !second) return false;
  return (Object.keys(first) as (keyof ActiveMarks)[]).every(
    (key) => first[key] === second[key],
  );
}

export function useMarkdownEditorToolbarState(
  editor: Editor | null,
): ActiveMarks {
  return (
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }): ActiveMarks =>
        currentEditor
          ? {
              bold: currentEditor.isActive("bold"),
              italic: currentEditor.isActive("italic"),
              strike: currentEditor.isActive("strike"),
              code: currentEditor.isActive("code"),
              h1: currentEditor.isActive("heading", { level: 1 }),
              h2: currentEditor.isActive("heading", { level: 2 }),
              h3: currentEditor.isActive("heading", { level: 3 }),
              bulletList: currentEditor.isActive("bulletList"),
              orderedList: currentEditor.isActive("orderedList"),
              blockquote: currentEditor.isActive("blockquote"),
              codeBlock: currentEditor.isActive("codeBlock"),
              link: currentEditor.isActive("link"),
            }
          : NO_ACTIVE,
      equalityFn: sameActive,
    }) ?? NO_ACTIVE
  );
}
