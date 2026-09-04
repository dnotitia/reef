import type { Editor } from "@tiptap/react";
import type { KeyboardEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { normalizeUrl } from "./links";
import type { EditorSelectionRange } from "./types";

export interface MarkdownEditorLinkState {
  isOpen: boolean;
  url: string;
  setUrl: (url: string) => void;
  close: () => void;
  rememberSelection: () => void;
  toggle: () => void;
  apply: () => void;
  remove: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function useMarkdownEditorLinkEditor(
  editor: Editor | null,
  activeLink: boolean,
): MarkdownEditorLinkState {
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const selectionRef = useRef<EditorSelectionRange | null>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    setUrl("");
    selectionRef.current = null;
  }, []);

  const rememberSelection = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    selectionRef.current = { from, to };
  }, [editor]);

  const open = useCallback(() => {
    if (!editor) return;
    // Pointer activation snapshots on mousedown, before the toolbar can
    // collapse ProseMirror's selection. Keyboard activation has no mousedown,
    // so capture the still-current selection here instead.
    if (!selectionRef.current) rememberSelection();
    const href =
      (editor.getAttributes("link").href as string | undefined) ?? "";
    setUrl(href);
    setIsOpen(true);
  }, [editor, rememberSelection]);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [close, isOpen, open]);

  const apply = useCallback(() => {
    if (!editor) return;
    const href = normalizeUrl(url);
    // Empty/invalid input: apply nothing and keep the current selection.
    if (!href) {
      close();
      return;
    }
    const selection = selectionRef.current;
    const chain = editor.chain().focus();
    if (selection) chain.setTextSelection(selection);
    chain.extendMarkRange("link");
    if ((!selection || selection.from === selection.to) && !activeLink) {
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
    close();
  }, [activeLink, close, editor, url]);

  const remove = useCallback(() => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (selectionRef.current) {
      chain.setTextSelection(selectionRef.current);
    }
    chain.extendMarkRange("link").unsetLink().run();
    close();
  }, [close, editor]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        // Prevent submitting the surrounding issue form.
        event.preventDefault();
        apply();
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    },
    [apply, close],
  );

  return {
    isOpen,
    url,
    setUrl,
    close,
    rememberSelection,
    toggle,
    apply,
    remove,
    onKeyDown,
  };
}
