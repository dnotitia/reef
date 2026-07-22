import {
  type AdfMediaReference,
  type AdfToMarkdownOptions,
  convertAdfToMarkdown,
} from "../content/adf.js";
import type { NormalizedJiraAttachment } from "../payloads.js";
import type {
  AttachmentBinding,
  JiraRelatedImportReport,
} from "./contracts.js";
import { failure } from "./reporting.js";

const decodeHtmlAttribute = (value: string): string =>
  value.replace(
    /&(?:amp|quot|apos|lt|gt|#39|#x27);/giu,
    (entity) =>
      ({
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
        "&#39;": "'",
        "&#x27;": "'",
      })[entity.toLowerCase()] ?? entity,
  );

const parseQuotedHtmlAttributes = (tag: string): Map<string, string | null> => {
  const attributes = new Map<string, string | null>();
  let cursor = 1;
  while (cursor < tag.length && !/\s/u.test(tag[cursor] ?? "")) cursor += 1;

  while (cursor < tag.length) {
    while (
      cursor < tag.length &&
      (/\s/u.test(tag[cursor] ?? "") || tag[cursor] === "/")
    ) {
      cursor += 1;
    }
    const nameStart = cursor;
    while (cursor < tag.length && !/[\s=>/]/u.test(tag[cursor] ?? "")) {
      cursor += 1;
    }
    if (cursor === nameStart) break;
    const name = tag.slice(nameStart, cursor).toLowerCase();
    while (cursor < tag.length && /\s/u.test(tag[cursor] ?? "")) cursor += 1;
    if (tag[cursor] !== "=") continue;
    cursor += 1;
    while (cursor < tag.length && /\s/u.test(tag[cursor] ?? "")) cursor += 1;
    const quote = tag[cursor];
    if (quote !== '"' && quote !== "'") continue;
    const valueStart = cursor + 1;
    const valueEnd = tag.indexOf(quote, valueStart);
    if (valueEnd === -1) break;
    const value = tag.slice(valueStart, valueEnd);
    const existing = attributes.get(name);
    attributes.set(
      name,
      existing === undefined || existing === value ? value : null,
    );
    cursor = valueEnd + 1;
  }
  return attributes;
};

const decimalAttribute = (value: string | null | undefined): string | null => {
  if (!value) return null;
  for (const character of value) {
    if (character < "0" || character > "9") return null;
  }
  return value;
};

const attachmentIdFromHref = (
  href: string | null | undefined,
): string | null => {
  if (!href) return null;
  const lowerHref = href.toLowerCase();
  for (const marker of ["attachment/", "att"]) {
    let offset = 0;
    while (offset < lowerHref.length) {
      const markerIndex = lowerHref.indexOf(marker, offset);
      if (markerIndex === -1) break;
      const idStart = markerIndex + marker.length;
      let idEnd = idStart;
      while (
        idEnd < href.length &&
        href[idEnd] !== undefined &&
        href[idEnd] >= "0" &&
        href[idEnd] <= "9"
      ) {
        idEnd += 1;
      }
      const delimiter = href[idEnd];
      if (
        idEnd > idStart &&
        (delimiter === undefined ||
          delimiter === "/" ||
          delimiter === "?" ||
          delimiter === '"' ||
          delimiter === "'")
      ) {
        return href.slice(idStart, idEnd);
      }
      offset = markerIndex + 1;
    }
  }
  return null;
};

const renderedHints = (
  html: string,
): Map<
  string,
  { attachmentId: string | null; filename: string | null } | null
> => {
  const hints = new Map<
    string,
    { attachmentId: string | null; filename: string | null } | null
  >();
  let cursor = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart === -1) break;
    const tagEnd = html.indexOf(">", tagStart + 1);
    if (tagEnd === -1) break;
    cursor = tagEnd + 1;
    const attributes = parseQuotedHtmlAttributes(
      html.slice(tagStart, tagEnd + 1),
    );
    const mediaId = attributes.get("data-media-services-id");
    if (!mediaId) continue;
    const hrefAttachmentId = attachmentIdFromHref(attributes.get("href"));
    const explicitAttachmentId = decimalAttribute(
      attributes.get("data-attachment-id"),
    );
    const attachmentId =
      hrefAttachmentId &&
      explicitAttachmentId &&
      hrefAttachmentId !== explicitAttachmentId
        ? null
        : (explicitAttachmentId ?? hrefAttachmentId);
    const encodedName =
      attributes.get("data-filename") ??
      attributes.get("alt") ??
      attributes.get("title") ??
      null;
    const hint = {
      attachmentId,
      filename: encodedName ? decodeHtmlAttribute(encodedName) : null,
    };
    const existing = hints.get(mediaId);
    hints.set(
      mediaId,
      existing === undefined ||
        (existing !== null &&
          existing.attachmentId === hint.attachmentId &&
          existing.filename === hint.filename)
        ? hint
        : null,
    );
  }
  return hints;
};

export type JiraMediaResolutionStrategy =
  | "unique_filename"
  | "sole_attachment"
  | "rendered_element"
  | "rendered_unique_filename";

export const resolveJiraMediaReference = (
  media: AdfMediaReference,
  attachments: readonly AttachmentBinding[],
  renderedHtml: string,
  sourceAttachments: readonly NormalizedJiraAttachment[] = attachments.map(
    (item) => item.source,
  ),
): {
  binding: AttachmentBinding;
  strategy: JiraMediaResolutionStrategy;
} | null => {
  if (media.mediaType !== "file") return null;
  const hint = renderedHints(renderedHtml).get(media.mediaId);
  if (media.filename) {
    const candidates = sourceAttachments.filter(
      (item) => item.filename === media.filename,
    );
    if (candidates.length === 1) {
      const binding = attachments.find(
        (item) => item.source.id === candidates[0]?.id,
      );
      return binding ? { binding, strategy: "unique_filename" } : null;
    }
  }
  if (sourceAttachments.length === 1) {
    const binding = attachments.find(
      (item) => item.source.id === sourceAttachments[0]?.id,
    );
    return binding ? { binding, strategy: "sole_attachment" } : null;
  }
  if (!hint) return null;
  if (hint.attachmentId) {
    const candidates = sourceAttachments.filter(
      (item) => item.id === hint.attachmentId,
    );
    if (candidates.length === 1) {
      const binding = attachments.find(
        (item) => item.source.id === candidates[0]?.id,
      );
      return binding ? { binding, strategy: "rendered_element" } : null;
    }
    if (candidates.length > 1) return null;
  }
  if (hint.filename) {
    const candidates = sourceAttachments.filter(
      (item) => item.filename === hint.filename,
    );
    if (candidates.length === 1) {
      const binding = attachments.find(
        (item) => item.source.id === candidates[0]?.id,
      );
      return binding ? { binding, strategy: "rendered_unique_filename" } : null;
    }
  }
  return null;
};

export const revokedAttachmentPlaceholder = (attachmentId: string): string =>
  `\u{e002}jira-attachment-revoked:${encodeURIComponent(attachmentId)}\u{e003}`;

const matchesMediaProjection = (
  canonicalMarkdown: string,
  mediaTokens: readonly {
    placeholder: string;
    alternatives: readonly string[];
  }[],
  candidate: string,
): boolean => {
  const segments: string[] = [];
  let canonicalOffset = 0;
  for (const token of mediaTokens) {
    const tokenOffset = canonicalMarkdown.indexOf(
      token.placeholder,
      canonicalOffset,
    );
    if (tokenOffset < 0) return false;
    segments.push(canonicalMarkdown.slice(canonicalOffset, tokenOffset));
    canonicalOffset = tokenOffset + token.placeholder.length;
  }
  segments.push(canonicalMarkdown.slice(canonicalOffset));
  const visited = new Set<string>();
  const visit = (tokenIndex: number, candidateOffset: number): boolean => {
    const visitKey = `${tokenIndex}:${candidateOffset}`;
    if (visited.has(visitKey)) return false;
    visited.add(visitKey);
    const segment = segments[tokenIndex];
    if (
      segment === undefined ||
      !candidate.startsWith(segment, candidateOffset)
    )
      return false;
    const nextOffset = candidateOffset + segment.length;
    if (tokenIndex === mediaTokens.length)
      return nextOffset === candidate.length;
    const token = mediaTokens[tokenIndex];
    if (!token) return false;
    return token.alternatives.some(
      (alternative) =>
        candidate.startsWith(alternative, nextOffset) &&
        visit(tokenIndex + 1, nextOffset + alternative.length),
    );
  };
  return visit(0, 0);
};

export const rewriteMedia = (
  adf: unknown,
  bindings: readonly AttachmentBinding[],
  renderedHtml: string,
  report: JiraRelatedImportReport,
  sourceId: string,
  sourceAttachments: readonly NormalizedJiraAttachment[],
  conversionOptions: AdfToMarkdownOptions = {},
): {
  markdown: string;
  preRewriteMarkdown: string;
  legacyPreRewriteMarkdown: string;
  revokedPreRewriteMarkdown: string;
  matchesPreRewriteMarkdown: (candidate: string) => boolean;
  resolved: boolean;
  changed: boolean;
} => {
  const converted = convertAdfToMarkdown(adf, conversionOptions);
  let markdown = converted.markdown;
  let legacyPreRewriteMarkdown = converted.markdown;
  let revokedPreRewriteMarkdown = converted.markdown;
  const mediaTokens: {
    placeholder: string;
    alternatives: string[];
  }[] = [];
  let resolved = true;
  for (const media of converted.media) {
    legacyPreRewriteMarkdown = legacyPreRewriteMarkdown.replace(
      media.placeholder,
      media.legacyPlaceholder,
    );
    report.media.total += 1;
    const resolution = resolveJiraMediaReference(
      media,
      bindings,
      renderedHtml,
      sourceAttachments,
    );
    if (!resolution) {
      resolved = false;
      report.media.unresolved += 1;
      failure(
        report.failures,
        "media",
        `${sourceId}:${media.mediaId}`,
        "resolve",
        "media_crosswalk_unresolved_or_ambiguous",
      );
      continue;
    }
    markdown = markdown
      .split(media.placeholder)
      .join(resolution.binding.fileUri);
    revokedPreRewriteMarkdown = revokedPreRewriteMarkdown.replace(
      media.placeholder,
      revokedAttachmentPlaceholder(resolution.binding.source.id),
    );
    mediaTokens.push({
      placeholder: media.placeholder,
      alternatives: [
        media.placeholder,
        media.legacyPlaceholder,
        revokedAttachmentPlaceholder(resolution.binding.source.id),
        resolution.binding.fileUri,
      ].filter((value, index, values) => values.indexOf(value) === index),
    });
    report.media.rewritten += 1;
    report.media.by_strategy[resolution.strategy] =
      (report.media.by_strategy[resolution.strategy] ?? 0) + 1;
  }
  return {
    markdown,
    preRewriteMarkdown: converted.markdown,
    legacyPreRewriteMarkdown,
    revokedPreRewriteMarkdown,
    matchesPreRewriteMarkdown: (candidate) =>
      matchesMediaProjection(converted.markdown, mediaTokens, candidate),
    resolved,
    changed: markdown !== converted.markdown,
  };
};
