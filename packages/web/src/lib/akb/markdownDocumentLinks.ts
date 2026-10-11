import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { akbDocumentSlugTitle, parseAkbDocumentUri } from "./documentUri";

const MARKDOWN_AKB_LINK_RE =
  /(!?)\[((?:\\[^\r\n]|[^\\\]\r\n]|\](?!\())*)\]\((akb:\/\/[^\s)]+)([^)]*)\)/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;
const BARE_AKB_URI_RE = /akb:\/\/[^\s<>"'`()[\]]+/g;

interface LinkRange {
  from: number;
  to: number;
}

function isAkbDocumentUri(uri: string): boolean {
  return parseAkbDocumentUri(uri) !== null;
}

function trimTrailingPunctuation(raw: string): {
  uri: string;
  trailing: string;
} {
  const trailing = TRAILING_PUNCTUATION_RE.exec(raw)?.[0] ?? "";
  return trailing
    ? { uri: raw.slice(0, -trailing.length), trailing }
    : { uri: raw, trailing: "" };
}

function collectMarkdownLinkRanges(markdown: string): LinkRange[] {
  return [...markdown.matchAll(MARKDOWN_AKB_LINK_RE)].map((match) => ({
    from: match.index ?? 0,
    to: (match.index ?? 0) + match[0].length,
  }));
}

function isInsideRange(index: number, ranges: readonly LinkRange[]): boolean {
  return ranges.some((range) => index >= range.from && index < range.to);
}

function overlapsRange(
  from: number,
  to: number,
  ranges: readonly LinkRange[],
): boolean {
  return ranges.some((range) => from < range.to && to > range.from);
}

function collectMarkdownCodeRanges(markdown: string): LinkRange[] {
  const ranges: LinkRange[] = [];
  visit(fromMarkdown(markdown), (node) => {
    if (node.type !== "code" && node.type !== "inlineCode") return;
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined || to <= from) return;
    ranges.push({ from, to });
  });
  return ranges;
}

function markdownLinkText(title: string): string {
  return title
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function titleForUri(
  uri: string,
  titleByUri: ReadonlyMap<string, string | null | undefined>,
): string {
  const resolved = titleByUri.get(uri);
  return resolved?.trim() || akbDocumentSlugTitle(uri);
}

function isReplaceableAkbLinkText(
  text: string,
  uri: string,
  fallback: string,
): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || trimmed === uri || trimmed === fallback;
}

function normalizeExistingAkbLinks(
  markdown: string,
  titleByUri: ReadonlyMap<string, string | null | undefined>,
  allowedUris?: ReadonlySet<string>,
): string {
  const codeRanges = collectMarkdownCodeRanges(markdown);
  return markdown.replace(
    MARKDOWN_AKB_LINK_RE,
    (
      match,
      imagePrefix: string,
      text: string,
      rawUri: string,
      suffix: string,
      offset: number,
    ) => {
      if (imagePrefix) return match;
      if (overlapsRange(offset, offset + match.length, codeRanges))
        return match;
      const { uri, trailing } = trimTrailingPunctuation(rawUri);
      if (trailing || !isAkbDocumentUri(uri)) return match;
      if (allowedUris && !allowedUris.has(uri)) return match;

      const fallback = akbDocumentSlugTitle(uri);
      if (!isReplaceableAkbLinkText(text, uri, fallback)) return match;

      const title = markdownLinkText(titleForUri(uri, titleByUri));
      return `[${title}](${uri}${suffix})`;
    },
  );
}

function linkBareAkbUris(
  markdown: string,
  titleByUri: ReadonlyMap<string, string | null | undefined>,
  allowedUris?: ReadonlySet<string>,
): string {
  const linkRanges = collectMarkdownLinkRanges(markdown);
  const codeRanges = collectMarkdownCodeRanges(markdown);
  return markdown.replace(BARE_AKB_URI_RE, (raw, offset: number) => {
    if (
      isInsideRange(offset, linkRanges) ||
      overlapsRange(offset, offset + raw.length, codeRanges)
    ) {
      return raw;
    }
    const { uri, trailing } = trimTrailingPunctuation(raw);
    if (!isAkbDocumentUri(uri)) return raw;
    if (allowedUris && !allowedUris.has(uri)) return raw;
    return `[${markdownLinkText(titleForUri(uri, titleByUri))}](${uri})${trailing}`;
  });
}

export function extractAkbDocumentUris(markdown: string): string[] {
  const uris = new Set<string>();
  const codeRanges = collectMarkdownCodeRanges(markdown);
  for (const match of markdown.matchAll(MARKDOWN_AKB_LINK_RE)) {
    const offset = match.index ?? 0;
    if (overlapsRange(offset, offset + match[0].length, codeRanges)) continue;
    const { uri, trailing } = trimTrailingPunctuation(match[3] ?? "");
    if (!trailing && isAkbDocumentUri(uri)) uris.add(uri);
  }
  const linkRanges = collectMarkdownLinkRanges(markdown);
  for (const match of markdown.matchAll(BARE_AKB_URI_RE)) {
    const offset = match.index ?? 0;
    if (
      isInsideRange(offset, linkRanges) ||
      overlapsRange(offset, offset + match[0].length, codeRanges)
    ) {
      continue;
    }
    const { uri } = trimTrailingPunctuation(match[0]);
    if (isAkbDocumentUri(uri)) uris.add(uri);
  }
  return [...uris];
}

export function normalizeExistingAkbDocumentMarkdownLinks(
  markdown: string,
  titleByUri: ReadonlyMap<string, string | null | undefined> = new Map(),
): string {
  return normalizeExistingAkbLinks(markdown, titleByUri);
}

export function normalizeAkbDocumentMarkdownLinks(
  markdown: string,
  titleByUri: ReadonlyMap<string, string | null | undefined> = new Map(),
): string {
  return linkBareAkbUris(
    normalizeExistingAkbLinks(markdown, titleByUri),
    titleByUri,
  );
}

export function normalizeAkbDocumentMarkdownLinksForUris(
  markdown: string,
  titleByUri: ReadonlyMap<string, string | null | undefined>,
  uris: readonly string[],
): string {
  const allowedUris = new Set(uris);
  return linkBareAkbUris(
    normalizeExistingAkbLinks(markdown, titleByUri, allowedUris),
    titleByUri,
    allowedUris,
  );
}
