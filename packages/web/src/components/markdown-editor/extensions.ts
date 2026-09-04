import {
  isAkbFileUri,
  attachmentFileTypeLabel,
} from "@/features/issues/lib/attachmentUrls";
import {
  buildAkbDocumentUrl,
  parseAkbDocumentUri,
} from "@/lib/akb/documentUri";
import { Extension, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { AnyExtension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import type { IssueBodyMentionExtensionOptions } from "../issueBodyMentionExtension";
import { createIssueBodyMentionExtension } from "../issueBodyMentionExtension";
import {
  createIssueBodyReferenceExtension,
  ISSUE_REFERENCE_MARK,
} from "../issueBodyReferenceExtension";
import type { SlashCommandMessages } from "../slashCommandExtension";
import { createSlashCommandExtension } from "../slashCommandExtension";

const boundedLowlight = createLowlight(common);
const scopedLowlight = {
  ...boundedLowlight,
  // Unknown and empty fences intentionally render as readable plain code. The
  // lowlight extension calls highlightAuto for those languages; an empty
  // subset keeps that fallback free of guessed token paint.
  highlightAuto: (value: string) =>
    boundedLowlight.highlightAuto(value, { subset: [] }),
};

/**
 * Tiptap's task-item node view creates a native checkbox, but leaves its
 * keyboard affordance implicit. Keep the browser's normal Tab order explicit
 * so the checkbox remains reachable inside the contenteditable surface.
 */
const AccessibleTaskItem = TaskItem.extend({
  addNodeView() {
    const renderNodeView = this.parent?.();
    if (!renderNodeView) return null;

    return (props: Parameters<typeof renderNodeView>[0]) => {
      const nodeView = renderNodeView(props);
      if (nodeView.dom instanceof HTMLElement) {
        nodeView.dom
          .querySelector<HTMLInputElement>('input[type="checkbox"]')
          ?.setAttribute("tabindex", "0");
      }
      return nodeView;
    };
  },
});

function createImageExtension(resolveImageSrc?: (src: string) => string) {
  return Image.extend({
    renderHTML({ HTMLAttributes }) {
      const attrs = { ...HTMLAttributes };
      if (typeof attrs.src === "string") {
        attrs.src = resolveImageSrc?.(attrs.src) ?? attrs.src;
      }
      return ["img", { ...this.options.HTMLAttributes, ...attrs }];
    },
  }).configure({
    allowBase64: false,
    HTMLAttributes: {
      class: "max-w-full rounded-md border border-border-subtle",
    },
  });
}

function createIssueAttachmentLinkExtension(
  resolveAttachmentHref?: (href: string) => string | undefined,
  akbWebBase?: string | null,
) {
  return LinkExtension.extend({
    parseMarkdown(token, helpers) {
      const content = helpers.parseInline(token.tokens ?? []).map((node) => {
        if (!node.marks) return node;
        return {
          ...node,
          marks: node.marks.filter(
            (mark) => mark.type !== ISSUE_REFERENCE_MARK,
          ),
        };
      });
      return helpers.applyMark("link", content, {
        href: token.href,
        title: token.title || null,
      });
    },
    renderHTML({ HTMLAttributes, mark }) {
      const attrs = { ...HTMLAttributes };
      const href = typeof attrs.href === "string" ? attrs.href : "";
      if (isAkbFileUri(href)) {
        attrs["data-reference-kind"] = "file";
        attrs["data-reef-file-link"] = "true";
        attrs["data-reef-file-uri"] = href;
        const resolvedHref = resolveAttachmentHref?.(href);
        if (resolvedHref) {
          attrs.href = resolvedHref;
          attrs.target = "_blank";
          attrs.rel = "noreferrer";
        }
      } else if (parseAkbDocumentUri(href)) {
        attrs["data-reference-kind"] = "document";
        attrs["data-document-uri"] = href;
        // Keep the mark's authored URI untouched while exposing the runtime
        // AKB web destination to the rendered editor and click policy.
        const renderedHref = buildAkbDocumentUrl(akbWebBase, href);
        if (renderedHref) {
          attrs.href = renderedHref;
          attrs["data-akb-uri"] = href;
          attrs.target = "_blank";
          attrs.rel = "noreferrer";
        }
      }
      return (
        this.parent?.({ mark, HTMLAttributes: attrs }) ?? [
          "a",
          mergeAttributes(this.options.HTMLAttributes, attrs),
          0,
        ]
      );
    },
  }).configure({
    openOnClick: false,
    HTMLAttributes: { tabindex: 0 },
    protocols: [{ scheme: "akb", optionalSlashes: true }],
    isAllowedUri: (url, ctx) =>
      url.startsWith("akb://")
        ? parseAkbDocumentUri(url) !== null || isAkbFileUri(url)
        : ctx.defaultValidate(url),
  });
}

function createIssueAttachmentLinkDecorationExtension() {
  return Extension.create({
    name: "issueAttachmentLinkDecoration",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations: (state) => {
              const decorations: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return;
                const href = node.marks.find(
                  (mark) => mark.type.name === "link",
                )?.attrs.href;
                if (typeof href !== "string" || !isAkbFileUri(href)) return;

                const attrs: Record<string, string> = {
                  "data-reef-file-type": attachmentFileTypeLabel(node.text),
                };
                decorations.push(
                  Decoration.inline(pos, pos + node.nodeSize, attrs),
                );
              });
              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
      ];
    },
  });
}

export function createMarkdownEditorExtensions(
  placeholder: string,
  resolveImageSrc?: (src: string) => string,
  mentionConfig?: IssueBodyMentionExtensionOptions,
  resolveAttachmentHref?: (href: string) => string | undefined,
  slashMessages?: SlashCommandMessages,
  issueReferenceVault?: string,
  slashOnOpenChange?: (open: boolean, dismiss?: () => void) => void,
  akbWebBase?: string | null,
) {
  const extensions: AnyExtension[] = [
    // StarterKit v3 bundles the Link extension; configure it here rather than
    // registering a second @tiptap/extension-link (which warns about a
    // duplicate 'link' extension and leaves link behavior ambiguous).
    // CodeBlockLowlight owns the codeBlock node below; disabling StarterKit's
    // copy avoids duplicate node names while preserving every other starter
    // mark/block.
    StarterKit.configure({ link: false, codeBlock: false }),
    // Keep the shared Link behavior while adding issue-scoped file-link
    // display attributes at render time. The authored AKB URI remains the
    // mark's href and therefore remains the Markdown serialization value.
    createIssueAttachmentLinkExtension(resolveAttachmentHref, akbWebBase),
    TaskList,
    AccessibleTaskItem.configure({ nested: true }),
    Table.configure({
      resizable: false,
      renderWrapper: false,
      HTMLAttributes: { class: "reef-markdown-table" },
    }),
    TableRow,
    TableHeader,
    TableCell,
    CodeBlockLowlight.configure({
      lowlight: scopedLowlight,
      HTMLAttributes: { class: "reef-markdown-code-block" },
    }),
    createImageExtension(resolveImageSrc),
    createIssueAttachmentLinkDecorationExtension(),
    Markdown,
    Placeholder.configure({
      placeholder,
      // Keep the empty textblock decorated after focus leaves the editor. The
      // CSS limits painting to the sole top-level block of an empty document.
      showOnlyCurrent: false,
    }),
    createSlashCommandExtension({
      messages: slashMessages,
      onOpenChange: slashOnOpenChange,
    }),
  ];
  if (mentionConfig) {
    extensions.push(
      createIssueBodyReferenceExtension({
        issuesRef: mentionConfig.issuesRef ?? { current: [] },
        vault: issueReferenceVault,
      }),
    );
    extensions.push(createIssueBodyMentionExtension(mentionConfig));
  }
  return extensions;
}
