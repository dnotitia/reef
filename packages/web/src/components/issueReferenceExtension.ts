import type { IssueListItem } from "@reef/core";
import {
  Mark,
  mergeAttributes,
  type JSONContent,
  type MarkdownParseHelpers,
  type MarkdownToken,
  type MarkdownTokenizer,
} from "@tiptap/core";

import { withVault } from "@/lib/workspaceHref";

/** The mark name is intentionally private to the issue-body editor surface. */
export const ISSUE_REFERENCE_MARK = "issueReference";

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function knownIssueAlternation(
  issues: ReadonlyMap<string, IssueListItem>,
): string | null {
  const ids = [...issues.values()]
    .map((issue) => issue.id)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  return ids.length > 0 ? ids.join("|") : null;
}

function findKnownIssueStart(
  source: string,
  issues: ReadonlyMap<string, IssueListItem>,
): number {
  const alternation = knownIssueAlternation(issues);
  if (!alternation) return -1;
  const match = new RegExp(
    `(?<![\\p{L}\\p{N}_-])(?:${alternation})(?![\\p{L}\\p{N}_-])`,
    "iu",
  ).exec(source);
  const index = match?.index ?? -1;
  return index >= 0 && isEscaped(source, index) ? index - 1 : index;
}

function createIssueReferenceTokenizer(
  options: IssueReferenceExtensionOptions,
): MarkdownTokenizer {
  return {
    name: ISSUE_REFERENCE_MARK,
    level: "inline",
    start: (source) => findKnownIssueStart(source, options.issuesRef.current),
    tokenize(source, tokens): MarkdownToken | undefined {
      const alternation = knownIssueAlternation(options.issuesRef.current);
      if (!alternation) return undefined;
      const escapedMatch = source.match(
        new RegExp(`^\\\\(${alternation})(?![\\p{L}\\p{N}_-])`, "iu"),
      );
      if (escapedMatch) {
        const raw = escapedMatch[1];
        const issue = options.issuesRef.current.get(issueReferenceMapKey(raw));
        if (issue) {
          return {
            type: ISSUE_REFERENCE_MARK,
            raw: escapedMatch[0],
            text: raw,
            attributes: { id: issue.id, escaped: true },
          };
        }
      }

      const previous = tokens.at(-1);
      const previousBackslashes =
        typeof previous?.text === "string"
          ? (previous.text.match(/\\+$/)?.[0].length ?? 0)
          : 0;
      const previousEscapedBackslash =
        previous?.type === "escape" && previous.text === "\\";
      if (
        (previous?.type === "text" &&
          previousBackslashes > 0 &&
          previousBackslashes % 2 === 1) ||
        previousEscapedBackslash
      ) {
        // Marked may split an escaped id into a preceding text/escape token
        // (`\\`) followed by this extension's source window. Return a plain
        // token so the escape remains ordinary Markdown rather than a
        // semantic mark. The escape token is retained in the surrounding
        // parse, so serialization stays stable across a reparse.
        const raw = source.match(
          new RegExp(`^(?:${alternation})(?![\\p{L}\\p{N}_-])`, "iu"),
        )?.[0];
        return raw ? { type: "text", raw, text: raw } : undefined;
      }
      const match = source.match(
        new RegExp(`^(?:${alternation})(?![\\p{L}\\p{N}_-])`, "iu"),
      );
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
  const escaped = token.attributes?.escaped === true;
  const text = escaped && raw.startsWith("\\") ? raw.slice(1) : raw;
  const encodedId =
    typeof token.attributes?.id === "string" ? token.attributes.id : raw;
  return helpers.applyMark(
    ISSUE_REFERENCE_MARK,
    [helpers.createTextNode(text)],
    { id: encodedId, escaped },
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
  const content = helpers.renderChildren(node);
  return node.attrs?.escaped === true ? `\\${content}` : content;
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
        escaped: { default: false },
      };
    },
    markdownTokenizer: createIssueReferenceTokenizer(options),
    parseMarkdown: parseIssueReference,
    renderMarkdown: renderIssueReference,
    renderHTML({ mark, HTMLAttributes }) {
      if (mark.attrs.escaped === true) {
        return [
          "span",
          { "data-escaped-issue": "true" },
          ["span", { "aria-hidden": "true" }, "\\"],
          ["span", {}, 0],
        ];
      }

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
        "data-issue-reference": "true",
        "data-issue-id": issue.id,
        "data-issue-status": issue.status,
        "data-issue-title": issue.title,
        ...(href
          ? {
              "data-issue-href": href,
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
            "data-issue-status-glyph": "true",
            "data-issue-status": issue.status,
            "aria-hidden": "true",
          },
          ["span", { "data-issue-status-half": "true" }],
        ],
        ["span", { "data-issue-id-text": "true", translate: "no" }, 0],
        [
          "span",
          { "data-issue-title": "true", "aria-hidden": "true" },
          issue.title,
        ],
      ];
    },
  });
}
