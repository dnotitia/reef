import type { VaultMember } from "@reef/core";
import type { Editor } from "@tiptap/react";
import { prepareIssueBodyMentionMarkdown } from "../issueBodyMentionExtension";

function markdownForEditor(
  markdown: string,
  mentionMembers?: readonly VaultMember[],
) {
  return mentionMembers
    ? prepareIssueBodyMentionMarkdown(markdown, mentionMembers)
    : markdown;
}

export function syncEditorMarkdown(
  editor: Editor | null | undefined,
  markdown: string,
  mentionMembers?: readonly VaultMember[],
) {
  if (!editor || editor.isDestroyed) return;
  if (editor.getMarkdown() === markdown) return;
  editor.commands.setContent(markdownForEditor(markdown, mentionMembers), {
    contentType: "markdown",
    emitUpdate: false,
  });
}

export function setEditorMarkdown(
  editor: Editor | null | undefined,
  markdown: string,
  mentionMembers?: readonly VaultMember[],
) {
  if (!editor || editor.isDestroyed) return;
  editor.commands.setContent(markdownForEditor(markdown, mentionMembers), {
    contentType: "markdown",
    emitUpdate: false,
  });
}
