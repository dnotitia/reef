import { createMarkdownExtensions } from "@akb/markdown-editor";
import {
  attachmentFileTypeLabel,
  isAkbFileUri,
} from "@/features/issues/lib/attachmentUrls";
import {
  buildAkbDocumentUrl,
  parseAkbDocumentUri,
} from "@/lib/akb/documentUri";
import {
  Extension,
  type Mark,
  mergeAttributes,
  type Node,
  type AnyExtension,
  type MarkdownParseHelpers,
  type MarkdownToken,
} from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
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
  // presentation decoration calls highlightAuto with an empty subset so it
  // does not guess a grammar and paint unrelated tokens.
  highlightAuto: (value: string) =>
    boundedLowlight.highlightAuto(value, { subset: [] }),
};

interface LowlightNode {
  children?: LowlightNode[];
  properties?: { className?: string[] };
  value?: string;
}

function highlightedChildren(result: unknown): LowlightNode[] {
  if (!result || typeof result !== "object") return [];
  const root = result as { children?: unknown; value?: unknown };
  if (Array.isArray(root.children)) return root.children as LowlightNode[];
  if (Array.isArray(root.value)) return root.value as LowlightNode[];
  return [];
}

function flattenHighlightNodes(
  nodes: readonly LowlightNode[],
  inheritedClasses: readonly string[] = [],
): Array<{ classes: readonly string[]; text: string }> {
  return nodes.flatMap((node) => {
    const classes = [
      ...inheritedClasses,
      ...(node.properties?.className ?? []),
    ];
    if (node.children) return flattenHighlightNodes(node.children, classes);
    return node.value ? [{ classes, text: node.value }] : [];
  });
}

function codeBlockDecorations(
  node: ProseMirrorNode,
  position: number,
  decorations: Decoration[],
): void {
  const language =
    typeof node.attrs.language === "string" && node.attrs.language
      ? node.attrs.language
      : null;
  const languages = scopedLowlight.listLanguages();
  const highlighted =
    language &&
    (languages.includes(language) || scopedLowlight.registered?.(language))
      ? scopedLowlight.highlight(language, node.textContent)
      : scopedLowlight.highlightAuto(node.textContent);

  let from = position + 1;
  for (const token of flattenHighlightNodes(highlightedChildren(highlighted))) {
    const to = from + token.text.length;
    if (token.classes.length > 0 && to > from) {
      decorations.push(
        Decoration.inline(from, to, { class: token.classes.join(" ") }),
      );
    }
    from = to;
  }
}

function markdownDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "codeBlock") {
      decorations.push(
        Decoration.node(position, position + node.nodeSize, {
          class: "reef-markdown-code-block",
        }),
      );
      codeBlockDecorations(node, position, decorations);
      return;
    }
    if (!node.isText || !node.text) return;

    const href = node.marks.find((mark) => mark.type.name === "link")?.attrs
      .href;
    if (typeof href !== "string" || !isAkbFileUri(href)) return;
    decorations.push(
      Decoration.inline(position, position + node.nodeSize, {
        "data-reef-file-type": attachmentFileTypeLabel(node.text),
      }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

function createMarkdownDecorationPlugin(): Plugin<DecorationSet> {
  let plugin: Plugin<DecorationSet>;
  plugin = new Plugin<DecorationSet>({
    state: {
      init: (_config, state) => markdownDecorations(state.doc),
      apply: (transaction, decorationSet) =>
        transaction.docChanged
          ? markdownDecorations(transaction.doc)
          : decorationSet.map(transaction.mapping, transaction.doc),
    },
    props: {
      decorations: (state) => plugin.getState(state),
    },
  });
  return plugin;
}

function createIssueAttachmentLinkExtension(
  sharedLink: Mark,
  resolveAttachmentHref: ((href: string) => string | undefined) | undefined,
  akbWebBase: string | null | undefined,
): AnyExtension {
  // The common package owns the Link schema and serializer. Extending the
  // instance produced by its StarterKit keeps one canonical Link runtime while
  // allowing Reef to strip issue-reference marks from link labels.
  return sharedLink
    .extend({
      parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
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
          attrs["data-markdown-target"] = href;
          const renderedHref = resolveAttachmentHref?.(href);
          if (renderedHref) {
            attrs.href = renderedHref;
            attrs.target = "_blank";
            attrs.rel = "noreferrer";
          }
        } else if (parseAkbDocumentUri(href)) {
          attrs["data-reference-kind"] = "document";
          attrs["data-document-uri"] = href;
          attrs["data-markdown-target"] = href;
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
    })
    .configure({
      openOnClick: false,
      HTMLAttributes: { tabindex: 0 },
      protocols: [{ scheme: "akb", optionalSlashes: true }],
      isAllowedUri: (
        url: string,
        context: { defaultValidate: (value: string) => boolean },
      ) =>
        url.startsWith("akb://")
          ? parseAkbDocumentUri(url) !== null || isAkbFileUri(url)
          : context.defaultValidate(url),
    });
}

function createIssueImageExtension(
  sharedImage: Node,
  resolveImageSrc?: (src: string) => string,
): AnyExtension {
  return sharedImage.extend({
    inline: false,
    group: "block",
    renderHTML({ node }: { node: ProseMirrorNode }) {
      const target = String(node.attrs.target || node.attrs.src || "");
      return [
        "img",
        {
          src: resolveImageSrc?.(target) ?? target,
          alt: String(node.attrs.alt ?? ""),
          ...(node.attrs.title ? { title: String(node.attrs.title) } : {}),
          "data-markdown-target": target,
          class: "max-w-full rounded-md border border-border-subtle",
        },
      ];
    },
    // Preserve the shared Markdown serializer while decoding its escaped image
    // labels back to the product's visible filename representation.
    parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
      const alt =
        typeof token.text === "string"
          ? token.text.replace(/\\\\/g, "\\")
          : token.text;
      return helpers.createNode("image", {
        target: token.href ?? "",
        alt,
        title: token.title ?? null,
      });
    },
  });
}

function createAccessibleTaskItemExtension(sharedTaskItem: Node): AnyExtension {
  const parentAddNodeView = sharedTaskItem.config.addNodeView;
  return sharedTaskItem.extend({
    addNodeView: function () {
      const renderNodeView = parentAddNodeView?.call(this);
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
}

function createMarkdownDecorationExtension(): AnyExtension {
  return Extension.create({
    name: "reefMarkdownDecorations",
    addProseMirrorPlugins() {
      return [createMarkdownDecorationPlugin()];
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
): AnyExtension[] {
  const extensions = createMarkdownExtensions({ profile: "preserve" });
  const starterIndex = extensions.findIndex(
    (extension) => extension.name === "starterKit",
  );
  const imageIndex = extensions.findIndex(
    (extension) => extension.name === "image",
  );
  const taskItemIndex = extensions.findIndex(
    (extension) => extension.name === "taskItem",
  );
  const starter = extensions[starterIndex];
  const sharedImage = extensions[imageIndex] as Node | undefined;
  const sharedTaskItem = extensions[taskItemIndex] as Node | undefined;
  const sharedLink = starter?.config.addExtensions
    ? (starter.config.addExtensions
        .call({
          name: starter.name,
          options: starter.options,
          storage: starter.storage,
          parent: undefined,
        })
        .find((extension) => extension.name === "link") as Mark | undefined)
    : undefined;
  if (
    !starter ||
    !sharedLink ||
    !sharedImage ||
    !sharedTaskItem ||
    starterIndex < 0 ||
    imageIndex < 0 ||
    taskItemIndex < 0
  ) {
    throw new Error(
      "@akb/markdown-editor did not expose its shared image and Link extensions",
    );
  }

  // Reef's existing attachment flow inserts one image block between Markdown
  // blocks. Keep that product layout while reusing the shared image attributes
  // and serializer instead of defining another image node.
  extensions[imageIndex] = createIssueImageExtension(
    sharedImage,
    resolveImageSrc,
  );
  extensions[taskItemIndex] = createAccessibleTaskItemExtension(sharedTaskItem);
  extensions.splice(
    starterIndex,
    1,
    starter.configure({ link: false }),
    createIssueAttachmentLinkExtension(
      sharedLink,
      resolveAttachmentHref,
      akbWebBase,
    ),
  );
  extensions.push(
    Placeholder.configure({
      placeholder,
      // Keep the empty textblock decorated after focus leaves the editor. The
      // CSS limits painting to the sole top-level block of an empty document.
      showOnlyCurrent: false,
    }),
    createMarkdownDecorationExtension(),
    createSlashCommandExtension({
      messages: slashMessages,
      onOpenChange: slashOnOpenChange,
    }),
  );
  if (mentionConfig) {
    extensions.push(
      createIssueBodyReferenceExtension({
        issuesRef: mentionConfig.issuesRef ?? { current: [] },
        vault: issueReferenceVault,
      }),
      createIssueBodyMentionExtension(mentionConfig),
    );
  }
  return extensions;
}
