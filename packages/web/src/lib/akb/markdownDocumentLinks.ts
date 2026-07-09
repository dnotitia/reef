import {
  akbDocumentSlugTitle,
  buildAkbDocumentUrl,
  parseAkbDocumentUri,
} from "./documentUri";

const BARE_AKB_URI_RE = /akb:\/\/[^\s<>"'`()[\]]+/g;
const MARKDOWN_AKB_LINK_RE = /(!?)\[([^\]\n]*)\]\((akb:\/\/[^\s)]+)([^)]*)\)/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;

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
): string {
  return markdown.replace(
    MARKDOWN_AKB_LINK_RE,
    (
      match,
      imagePrefix: string,
      text: string,
      rawUri: string,
      suffix: string,
    ) => {
      if (imagePrefix) return match;
      const { uri, trailing } = trimTrailingPunctuation(rawUri);
      if (trailing || !isAkbDocumentUri(uri)) return match;

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
): string {
  const linkRanges = collectMarkdownLinkRanges(markdown);
  return markdown.replace(BARE_AKB_URI_RE, (raw, offset: number) => {
    if (isInsideRange(offset, linkRanges)) return raw;
    const { uri, trailing } = trimTrailingPunctuation(raw);
    if (!isAkbDocumentUri(uri)) return raw;
    return `[${markdownLinkText(titleForUri(uri, titleByUri))}](${uri})${trailing}`;
  });
}

export function extractAkbDocumentUris(markdown: string): string[] {
  const uris = new Set<string>();
  for (const match of markdown.matchAll(MARKDOWN_AKB_LINK_RE)) {
    const { uri, trailing } = trimTrailingPunctuation(match[3] ?? "");
    if (!trailing && isAkbDocumentUri(uri)) uris.add(uri);
  }
  const linkRanges = collectMarkdownLinkRanges(markdown);
  for (const match of markdown.matchAll(BARE_AKB_URI_RE)) {
    const offset = match.index ?? 0;
    if (isInsideRange(offset, linkRanges)) continue;
    const { uri } = trimTrailingPunctuation(match[0]);
    if (isAkbDocumentUri(uri)) uris.add(uri);
  }
  return [...uris];
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

export function retargetRenderedAkbDocumentLinks(
  root: ParentNode,
  akbWebBase: string | null | undefined,
): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(
    'a[href^="akb://"], a[data-akb-uri]',
  )) {
    const uri = anchor.dataset.akbUri ?? anchor.getAttribute("href") ?? "";
    if (!isAkbDocumentUri(uri)) continue;
    anchor.dataset.akbUri = uri;
    anchor.setAttribute("href", buildAkbDocumentUrl(akbWebBase, uri) ?? uri);
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noreferrer");
  }
}
