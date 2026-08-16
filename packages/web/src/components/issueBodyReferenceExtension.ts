import { STATUS_COLORS } from "@/components/fields/fieldKit";
import { withVault } from "@/lib/workspaceHref";
import type { IssueListItem, Status } from "@reef/core";
import {
  Mark,
  mergeAttributes,
  type DOMOutputSpecArray,
  type MarkdownParseHelpers,
  type MarkdownToken,
  type MarkdownTokenizer,
} from "@tiptap/core";

const ISSUE_REFERENCE_MARK = "issueBodyReference";

export interface IssueBodyReferenceExtensionOptions {
  /** Mutable so a refreshed issue list is used without rebuilding the editor. */
  issuesRef: { current: readonly IssueListItem[] };
  /** Vault used for the existing issue detail route. */
  vault?: string;
}

function issueGlyph(status: Status): DOMOutputSpecArray {
  // Keep the existing StatusIcon geometry and semantic color classes here so
  // an issue reference remains recognizable in the editor, not as a second
  // status vocabulary.
  const attrs = {
    viewBox: "0 0 14 14",
    width: 14,
    height: 14,
    "data-reference-glyph": "issue",
    "data-reference-status": status,
    class: STATUS_COLORS[status],
    "aria-hidden": "true",
  };
  if (status === "backlog") {
    return [
      "svg",
      attrs,
      [
        "circle",
        {
          cx: 7,
          cy: 7,
          r: 5.5,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinecap: "round",
          strokeDasharray: "0.1 2.7",
        },
      ],
    ] as unknown as DOMOutputSpecArray;
  }
  if (status === "todo") {
    return [
      "svg",
      attrs,
      [
        "circle",
        {
          cx: 7,
          cy: 7,
          r: 5.5,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.4,
        },
      ],
    ] as unknown as DOMOutputSpecArray;
  }
  if (status === "in_progress") {
    return [
      "svg",
      attrs,
      [
        "circle",
        {
          cx: 7,
          cy: 7,
          r: 5.5,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.4,
        },
      ],
      ["path", { d: "M 7 1.5 A 5.5 5.5 0 0 1 7 12.5 Z", fill: "currentColor" }],
    ] as unknown as DOMOutputSpecArray;
  }
  if (status === "in_review") {
    return [
      "svg",
      attrs,
      [
        "circle",
        {
          cx: 7,
          cy: 7,
          r: 5.5,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeDasharray: "2 1.6",
        },
      ],
    ] as unknown as DOMOutputSpecArray;
  }
  if (status === "done") {
    return [
      "svg",
      attrs,
      ["circle", { cx: 7, cy: 7, r: 6, fill: "currentColor" }],
      [
        "path",
        {
          d: "M 4 7.2 L 6.2 9.4 L 10 5.4",
          fill: "none",
          stroke: "white",
          strokeWidth: 1.4,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        },
      ],
    ] as unknown as DOMOutputSpecArray;
  }
  return [
    "svg",
    attrs,
    ["circle", { cx: 7, cy: 7, r: 6, fill: "currentColor" }],
    [
      "path",
      {
        d: "M 4.6 4.6 L 9.4 9.4 M 9.4 4.6 L 4.6 9.4",
        fill: "none",
        stroke: "white",
        strokeWidth: 1.4,
        strokeLinecap: "round",
      },
    ],
  ] as unknown as DOMOutputSpecArray;
}

function escapeIssueId(id: string): string {
  return id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function issueIdPattern(issues: readonly IssueListItem[]): RegExp | null {
  const ids = Array.from(new Set(issues.map((issue) => issue.id)))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map(escapeIssueId);
  if (ids.length === 0) return null;
  return new RegExp(
    `(?<![\\p{L}\\p{N}_-])(${ids.join("|")})(?![\\p{L}\\p{N}_-])`,
    "u",
  );
}

function isEscaped(source: string): boolean {
  let backslashes = 0;
  for (
    let index = source.length - 1;
    index >= 0 && source[index] === "\\";
    index -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function createIssueBodyReferenceTokenizer(issuesRef: {
  current: readonly IssueListItem[];
}): MarkdownTokenizer {
  return {
    name: ISSUE_REFERENCE_MARK,
    level: "inline",
    start(source) {
      const pattern = issueIdPattern(issuesRef.current);
      if (!pattern) return -1;
      const match = source.match(pattern);
      if (!match || match.index === undefined) return -1;
      if (isEscaped(source.slice(0, match.index))) return -1;
      return match.index;
    },
    tokenize(source, tokens): MarkdownToken | undefined {
      const previous = tokens.at(-1);
      if (previous?.type === "text" && previous.raw?.endsWith("\\")) {
        return undefined;
      }
      const pattern = issueIdPattern(issuesRef.current);
      if (!pattern) return undefined;
      const match = source.match(pattern);
      if (!match || match.index !== 0) return undefined;
      if (isEscaped(source.slice(0, match.index))) return undefined;
      const id = match[1];
      const issue = issuesRef.current.find((candidate) => candidate.id === id);
      if (!issue) return undefined;
      return {
        type: ISSUE_REFERENCE_MARK,
        raw: id,
        text: id,
        attributes: {
          id: issue.id,
          title: issue.title,
          status: issue.status,
        },
      };
    },
  };
}

function parseIssueBodyReference(
  token: MarkdownToken,
  helpers: MarkdownParseHelpers,
) {
  const attrs = token.attributes as
    | { id?: unknown; title?: unknown; status?: unknown }
    | undefined;
  const id = typeof attrs?.id === "string" ? attrs.id : (token.text ?? "");
  const title = typeof attrs?.title === "string" ? attrs.title : id;
  const status = typeof attrs?.status === "string" ? attrs.status : "todo";
  return helpers.applyMark(ISSUE_REFERENCE_MARK, [helpers.createTextNode(id)], {
    id,
    title,
    status,
  });
}

function renderIssueBodyReferenceMarkdown(
  node: { content?: Array<{ text?: string }> },
  helpers: { renderChildren: (content: Array<{ text?: string }>) => string },
): string {
  return helpers.renderChildren(node.content ?? []);
}

function renderIssueBodyReferenceHTML({
  mark,
  HTMLAttributes,
  vault,
}: {
  mark: { attrs: Record<string, unknown> };
  HTMLAttributes: Record<string, unknown>;
  vault?: string;
}): DOMOutputSpecArray {
  const id = typeof mark.attrs.id === "string" ? mark.attrs.id : "";
  const title = typeof mark.attrs.title === "string" ? mark.attrs.title : id;
  const status =
    typeof mark.attrs.status === "string" ? mark.attrs.status : "todo";
  const href = withVault(vault ?? "", `/issues/${encodeURIComponent(id)}`);
  const {
    id: _id,
    title: _title,
    status: _status,
    ...linkAttributes
  } = HTMLAttributes;
  return [
    "a",
    mergeAttributes(linkAttributes, {
      href,
      target: "_blank",
      rel: "noreferrer",
      tabindex: 0,
      title: `${id} — ${title}`,
      "aria-label": `${id} ${title}`,
      "data-reference-kind": "issue",
      "data-issue-id": id,
      "data-issue-status": status,
      "data-issue-title": title,
    }),
    issueGlyph(status as Status),
    [
      "span",
      {
        "data-reference-id": "true",
        translate: "no",
      },
      0,
    ],
    ["span", { "data-reference-title": "true" }, title],
  ] as unknown as DOMOutputSpecArray;
}

export function createIssueBodyReferenceExtension({
  issuesRef,
  vault,
}: IssueBodyReferenceExtensionOptions) {
  return Mark.create({
    name: ISSUE_REFERENCE_MARK,
    inclusive: false,
    addAttributes() {
      return {
        id: { default: "" },
        title: { default: "" },
        status: { default: "todo" },
      };
    },
    markdownTokenizer: createIssueBodyReferenceTokenizer(issuesRef),
    parseMarkdown: parseIssueBodyReference,
    renderMarkdown: renderIssueBodyReferenceMarkdown,
    renderHTML({ mark, HTMLAttributes }) {
      return renderIssueBodyReferenceHTML({ mark, HTMLAttributes, vault });
    },
  });
}

export { ISSUE_REFERENCE_MARK };
