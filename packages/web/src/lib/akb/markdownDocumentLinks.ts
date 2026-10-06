import {
  akbDocumentSlugTitle,
  buildAkbDocumentUrl,
  parseAkbDocumentUri,
} from "./documentUri";

const MARKDOWN_AKB_LINK_RE =
  /(!?)\[((?:\\[^\r\n]|[^\\\]\r\n]|\](?!\())*)\]\((akb:\/\/[^\s)]+)([^)]*)\)/g;
const MARKDOWN_LINK_RE =
  /(!?)\[((?:\\[^\r\n]|[^\\\]\r\n]|\](?!\())*)\]\(([^\s)]+)([^)]*)\)/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;

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

export function extractAkbDocumentUris(markdown: string): string[] {
  const uris = new Set<string>();
  for (const match of markdown.matchAll(MARKDOWN_AKB_LINK_RE)) {
    const { uri, trailing } = trimTrailingPunctuation(match[3] ?? "");
    if (!trailing && isAkbDocumentUri(uri)) uris.add(uri);
  }
  return [...uris];
}

export function normalizeAkbDocumentMarkdownLinks(
  markdown: string,
  titleByUri: ReadonlyMap<string, string | null | undefined> = new Map(),
): string {
  return normalizeExistingAkbLinks(markdown, titleByUri);
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
    const renderedHref = buildAkbDocumentUrl(akbWebBase, uri);
    if (
      anchor.dataset.akbUri === uri &&
      renderedHref !== null &&
      anchor.getAttribute("href") === renderedHref &&
      anchor.getAttribute("target") === "_blank" &&
      anchor.getAttribute("rel") === "noreferrer"
    ) {
      continue;
    }
    anchor.dataset.akbUri = uri;
    anchor.setAttribute("href", renderedHref ?? uri);
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noreferrer");
  }
}

export function restoreRenderedAkbDocumentMarkdownLinks(
  markdown: string,
  root: ParentNode | null | undefined,
): string {
  if (!root) return markdown;

  const renderedHrefToUri = new Map<string, string>();
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(
    "a[data-akb-uri], a[data-document-uri]",
  )) {
    const uri = anchor.dataset.akbUri ?? anchor.dataset.documentUri ?? "";
    const renderedHref = anchor.getAttribute("href") ?? "";
    if (renderedHref && isAkbDocumentUri(uri)) {
      renderedHrefToUri.set(renderedHref, uri);
    }
  }
  if (renderedHrefToUri.size === 0) return markdown;

  return markdown.replace(
    MARKDOWN_LINK_RE,
    (
      match,
      imagePrefix: string,
      text: string,
      href: string,
      suffix: string,
    ) => {
      if (imagePrefix) return match;
      const uri = renderedHrefToUri.get(href);
      return uri ? `[${text}](${uri}${suffix})` : match;
    },
  );
}
