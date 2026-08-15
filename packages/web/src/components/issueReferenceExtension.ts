import type { IssueListItem } from "@reef/core";
import {
  Mark,
  mergeAttributes,
  type JSONContent,
  type MarkdownParseHelpers,
  type MarkdownToken,
  type MarkdownTokenizer,
} from "@tiptap/core";

import { REEF_ID_PATTERN } from "@/lib/markdown/remarkReefMentions";
import { withVault } from "@/lib/workspaceHref";

/** The mark name is intentionally private to the issue-body editor surface. */
export const ISSUE_REFERENCE_MARK = "reefIssueReference";

export interface IssueReferenceExtensionOptions {
  /** The loaded issue list is supplied by the caller; no editor-side fetch is needed. */
  issuesRef: { current: ReadonlyMap<string, IssueListItem> };
  vaultRef: { current: string | undefined };
  /** Mutable so a locale change updates an already-mounted lazy editor. */
  labelForRef: {
    current: (issue: IssueListItem) => string;
  };
}

export function issueReferenceMapKey(id: string): string {
  return id.toUpperCase();
}

export function buildIssueReferenceMap(
  issues: readonly IssueListItem[],
): Map<string, IssueListItem> {
  const map = new Map<string, IssueListItem>();
  for (const issue of issues) map.set(issueReferenceMapKey(issue.id), issue);
  return map;
}

/**
 * A stable fingerprint lets the editor reparse only when the caller's loaded
 * issue list actually changes. It intentionally includes the rendered fields:
 * a status/title refresh must update the semantic decoration without rebuilding
 * the Tiptap instance.
 */
export function issueReferenceFingerprint(
  issues: readonly IssueListItem[],
): string {
  return issues
    .map(
      (issue) =>
        `${issueReferenceMapKey(issue.id)}\u0000${issue.status}\u0000${issue.title}`,
    )
    .sort()
    .join("\u0001");
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findKnownIssueStart(
  source: string,
  issues: ReadonlyMap<string, IssueListItem>,
): number {
  const pattern = new RegExp(REEF_ID_PATTERN.source, "gi");
  for (const match of source.matchAll(pattern)) {
    const raw = match[0];
    const index = match.index ?? -1;
    if (index < 0 || isEscaped(source, index)) continue;
    if (issues.has(issueReferenceMapKey(raw))) return index;
  }
  return -1;
}

function createIssueReferenceTokenizer(
  options: IssueReferenceExtensionOptions,
): MarkdownTokenizer {
  return {
    name: ISSUE_REFERENCE_MARK,
    level: "inline",
    start: (source) => findKnownIssueStart(source, options.issuesRef.current),
    tokenize(source, tokens): MarkdownToken | undefined {
      const previous = tokens.at(-1);
      const previousBackslashes =
        typeof previous?.text === "string"
          ? (previous.text.match(/\\+$/)?.[0].length ?? 0)
          : 0;
      if (
        previous?.type === "text" &&
        previousBackslashes > 0 &&
        previousBackslashes % 2 === 1
      ) {
        // Marked may split an escaped id into a preceding text token (`\\`)
        // followed by this extension's source window. Return a plain token so
        // the escape remains ordinary Markdown rather than a semantic mark.
        const raw = source.match(
          new RegExp(`^${REEF_ID_PATTERN.source}`, "i"),
        )?.[0];
        return raw ? { type: "text", raw, text: raw } : undefined;
      }
      const match = source.match(new RegExp(`^${REEF_ID_PATTERN.source}`, "i"));
      if (!match) return undefined;
      const raw = match[0];
      const issue = options.issuesRef.current.get(issueReferenceMapKey(raw));
      if (!issue) return undefined;
      return {
        type: ISSUE_REFERENCE_MARK,
        raw,
        text: raw,
        attributes: { id: issue.id },
      };
    },
  };
}

function parseIssueReference(
  token: MarkdownToken,
  helpers: MarkdownParseHelpers,
) {
  const raw = typeof token.raw === "string" ? token.raw : (token.text ?? "");
  const encodedId =
    typeof token.attributes?.id === "string" ? token.attributes.id : raw;
  return helpers.applyMark(
    ISSUE_REFERENCE_MARK,
    [helpers.createTextNode(raw)],
    { id: encodedId },
  );
}

/** Remove issue marks when parsing an existing Markdown link label. */
export function stripIssueReferenceMarks(
  content: readonly JSONContent[],
): JSONContent[] {
  return content.map((node) => ({
    ...node,
    ...(node.marks
      ? {
          marks: node.marks.filter(
            (mark) => mark.type !== ISSUE_REFERENCE_MARK,
          ),
        }
      : {}),
    ...(node.content
      ? { content: stripIssueReferenceMarks(node.content) }
      : {}),
  }));
}

function renderIssueReference(
  node: { attrs?: Record<string, unknown> },
  helpers: { renderChildren: (node: JSONContent) => string },
) {
  return helpers.renderChildren(node);
}

export function createIssueReferenceExtension(
  options: IssueReferenceExtensionOptions,
) {
  return Mark.create({
    name: ISSUE_REFERENCE_MARK,
    priority: 900,
    inclusive: false,
    spanning: false,
    addAttributes() {
      return {
        id: { default: null },
      };
    },
    markdownTokenizer: createIssueReferenceTokenizer(options),
    parseMarkdown: parseIssueReference,
    renderMarkdown: renderIssueReference,
    renderHTML({ mark, HTMLAttributes }) {
      const id = typeof mark.attrs.id === "string" ? mark.attrs.id : "";
      const issue = options.issuesRef.current.get(issueReferenceMapKey(id));
      if (!issue) return ["span", 0];

      const vault = options.vaultRef.current;
      const href = vault
        ? withVault(vault, `/issues/${encodeURIComponent(issue.id)}`)
        : undefined;
      const label = options.labelForRef.current(issue);
      const renderAttributes = { ...HTMLAttributes };
      // The mark attribute is an internal canonical id, not a DOM id. Repeated
      // references to one issue must not create duplicate document ids.
      delete renderAttributes.id;
      const attrs = mergeAttributes(renderAttributes, {
        "data-reef-issue-reference": "true",
        "data-reef-issue-id": issue.id,
        "data-reef-issue-status": issue.status,
        "data-reef-issue-title": issue.title,
        ...(href
          ? {
              "data-reef-issue-href": href,
              role: "link",
              tabindex: 0,
            }
          : {}),
        "aria-label": label,
        title: label,
      });

      return [
        "span",
        attrs,
        [
          "span",
          {
            "data-reef-status-glyph": "true",
            "data-reef-status": issue.status,
            "aria-hidden": "true",
          },
          ["span", { "data-reef-status-half": "true" }],
        ],
        ["span", { "data-reef-issue-id-text": "true", translate: "no" }, 0],
        [
          "span",
          { "data-reef-issue-title": "true", "aria-hidden": "true" },
          issue.title,
        ],
      ];
    },
  });
}
