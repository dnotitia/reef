import {
  type IssueAttachmentCreateInput,
  IssueAttachmentCreateInputSchema,
} from "./attachment";

export interface JiraAttachmentImportInput {
  reefId: string;
  fileUri: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  author: string;
  createdAt: string;
  jiraAttachmentId: string;
  inline?: boolean;
  meta?: Record<string, unknown> | null;
}

export interface JiraAttachmentRewriteTarget {
  original_jira_attachment_id: string | null | undefined;
  file_uri: string;
}

const JIRA_ATTACHMENT_URL_PATTERN =
  /\/(?:secure\/attachment|rest\/api\/(?:2|3)\/attachment\/content)\/([^/?#)]+)/iu;
const MARKDOWN_LINK_OPEN = "](";

export function jiraAttachmentIdFromUrl(url: string): string | null {
  const match = url.match(JIRA_ATTACHMENT_URL_PATTERN);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1]);
}

export function buildJiraAttachmentCreateInput(
  input: JiraAttachmentImportInput,
): IssueAttachmentCreateInput {
  return IssueAttachmentCreateInputSchema.parse({
    reef_id: input.reefId,
    file_uri: input.fileUri,
    filename: input.filename,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    author: input.author,
    created_at: input.createdAt,
    source: "jira_import",
    inline: input.inline ?? false,
    original_jira_attachment_id: input.jiraAttachmentId,
    meta: input.meta ?? null,
  });
}

export function rewriteJiraAttachmentReferences(
  markdown: string,
  attachments: readonly JiraAttachmentRewriteTarget[],
): string {
  const fileUriByJiraId = new Map(
    attachments
      .filter((attachment) => attachment.original_jira_attachment_id)
      .map((attachment) => [
        attachment.original_jira_attachment_id as string,
        attachment.file_uri,
      ]),
  );
  if (fileUriByJiraId.size === 0) return markdown;

  function rewriteTarget(target: string): string {
    const explicitId = target.startsWith("jira-attachment://")
      ? target.slice("jira-attachment://".length)
      : null;
    const jiraId = explicitId ?? jiraAttachmentIdFromUrl(target);
    return jiraId ? (fileUriByJiraId.get(jiraId) ?? target) : target;
  }

  return rewriteExplicitJiraAttachmentTokens(
    rewriteMarkdownLinkTargets(markdown, rewriteTarget),
    rewriteTarget,
  );
}

function rewriteMarkdownLinkTargets(
  markdown: string,
  rewriteTarget: (target: string) => string,
): string {
  let result = "";
  let cursor = 0;

  while (cursor < markdown.length) {
    const openIndex = markdown.indexOf(MARKDOWN_LINK_OPEN, cursor);
    if (openIndex === -1) {
      result += markdown.slice(cursor);
      break;
    }

    const targetStart = openIndex + MARKDOWN_LINK_OPEN.length;
    const parsed = parseSimpleMarkdownLinkTarget(markdown, targetStart);
    if (!parsed) {
      result += markdown.slice(cursor, targetStart);
      cursor = targetStart;
      continue;
    }

    result += markdown.slice(cursor, targetStart);
    result += rewriteTarget(markdown.slice(targetStart, parsed.targetEnd));
    cursor = parsed.targetEnd;
  }

  return result;
}

function parseSimpleMarkdownLinkTarget(
  markdown: string,
  start: number,
): { targetEnd: number } | null {
  let index = start;
  while (
    index < markdown.length &&
    markdown[index] !== ")" &&
    !isMarkdownWhitespace(markdown.charCodeAt(index))
  ) {
    index += 1;
  }

  if (index === start || index >= markdown.length) return null;
  const targetEnd = index;
  if (markdown[index] === ")") return { targetEnd };

  while (
    index < markdown.length &&
    isMarkdownWhitespace(markdown.charCodeAt(index))
  ) {
    index += 1;
  }

  const quote = markdown[index];
  if (quote !== `"` && quote !== "'") return null;
  index += 1;

  while (index < markdown.length && markdown[index] !== quote) {
    if (markdown[index] === ")") return null;
    index += 1;
  }

  if (markdown[index] !== quote) return null;
  index += 1;

  while (
    index < markdown.length &&
    isMarkdownWhitespace(markdown.charCodeAt(index))
  ) {
    index += 1;
  }

  return markdown[index] === ")" ? { targetEnd } : null;
}

function rewriteExplicitJiraAttachmentTokens(
  markdown: string,
  rewriteTarget: (target: string) => string,
): string {
  const prefix = "jira-attachment://";
  let result = "";
  let cursor = 0;

  while (cursor < markdown.length) {
    const tokenStart = markdown.indexOf(prefix, cursor);
    if (tokenStart === -1) {
      result += markdown.slice(cursor);
      break;
    }

    let tokenEnd = tokenStart + prefix.length;
    while (
      tokenEnd < markdown.length &&
      isJiraAttachmentTokenChar(markdown.charCodeAt(tokenEnd))
    ) {
      tokenEnd += 1;
    }

    if (tokenEnd === tokenStart + prefix.length) {
      result += markdown.slice(cursor, tokenEnd);
      cursor = tokenEnd;
      continue;
    }

    result += markdown.slice(cursor, tokenStart);
    result += rewriteTarget(markdown.slice(tokenStart, tokenEnd));
    cursor = tokenEnd;
  }

  return result;
}

function isMarkdownWhitespace(charCode: number): boolean {
  return (
    charCode === 0x09 ||
    charCode === 0x0a ||
    charCode === 0x0d ||
    charCode === 0x20
  );
}

function isJiraAttachmentTokenChar(charCode: number): boolean {
  return (
    (charCode >= 0x30 && charCode <= 0x39) ||
    (charCode >= 0x41 && charCode <= 0x5a) ||
    (charCode >= 0x61 && charCode <= 0x7a) ||
    charCode === 0x2d ||
    charCode === 0x2e ||
    charCode === 0x5f
  );
}
