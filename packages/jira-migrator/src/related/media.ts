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
    /&(?:amp|quot|apos|lt|gt|#39|#x27|#91|#93|#x5b|#x5d);/giu,
    (entity) =>
      ({
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
        "&#39;": "'",
        "&#x27;": "'",
        "&#91;": "[",
        "&#93;": "]",
        "&#x5b;": "[",
        "&#x5d;": "]",
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
  for (const marker of ["attachment/content/", "attachment/", "att"]) {
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
    if (
      hrefAttachmentId &&
      explicitAttachmentId &&
      hrefAttachmentId !== explicitAttachmentId
    ) {
      hints.set(mediaId, null);
      continue;
    }
    const attachmentId = explicitAttachmentId ?? hrefAttachmentId;
    const encodedName =
      attributes.get("data-attachment-name") ??
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

interface RenderedAttachmentHint {
  attachmentId: string | null;
  filename: string | null;
}

/**
 * Jira's rendered comment HTML is not consistent across editor versions.
 * Older comments use a plain `<img src=".../attachment/content/<id>"
 * alt="...">` without the newer data-media-services attributes.  Keep those
 * hints separately so a media ADF id can still be cross-walked by its
 * rendered filename or attachment id.
 */
const renderedAttachmentHints = (html: string): RenderedAttachmentHint[] => {
  const hints: RenderedAttachmentHint[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart === -1) break;
    const tagEnd = html.indexOf(">", tagStart + 1);
    if (tagEnd === -1) break;
    cursor = tagEnd + 1;
    const tag = html.slice(tagStart, tagEnd + 1);
    const attributes = parseQuotedHtmlAttributes(tag);
    // Media-service elements are validated by renderedHints above.  Do not
    // let the previous parser bypass an ambiguous or malformed media id.
    if (attributes.has("data-media-services-id")) continue;
    const href = attributes.get("src") ?? attributes.get("href");
    const attachmentId = attachmentIdFromHref(href);
    const filename =
      attributes.get("data-attachment-name") ??
      attributes.get("data-filename") ??
      attributes.get("alt") ??
      attributes.get("title") ??
      null;
    if (attachmentId || filename) {
      hints.push({
        attachmentId,
        filename: filename ? decodeHtmlAttribute(filename) : null,
      });
    }
  }
  return hints;
};

const stripHtmlTags = (value: string): string => {
  let cursor = 0;
  let text = "";
  while (cursor < value.length) {
    const tagStart = value.indexOf("<", cursor);
    if (tagStart === -1) return text + value.slice(cursor);
    text += value.slice(cursor, tagStart);
    const tagEnd = value.indexOf(">", tagStart + 1);
    if (tagEnd === -1) return text + value.slice(tagStart);
    cursor = tagEnd + 1;
  }
  return text;
};

/**
 * Jira emits a wiki-style attachment error marker when it does not render a
 * file. It has no media-service id, but its text still carries the filename.
 * rewriteMedia consumes these names when they form a complete, unique
 * ordered crosswalk for the unresolved file media in the same document.
 */
const renderedErrorAttachmentFilenames = (html: string): string[] => {
  const filenames: string[] = [];
  const lowerHtml = html.toLowerCase();
  let cursor = 0;
  while (cursor < html.length) {
    const markerStart = lowerHtml.indexOf("[^", cursor);
    if (markerStart === -1) break;

    const spanStart = markerStart + 2;
    const spanNameEnd = lowerHtml[spanStart + 5];
    if (
      !lowerHtml.startsWith("<span", spanStart) ||
      (spanNameEnd !== undefined &&
        spanNameEnd !== ">" &&
        spanNameEnd !== "/" &&
        !/\s/u.test(spanNameEnd))
    ) {
      cursor = spanStart;
      continue;
    }

    const tagEnd = lowerHtml.indexOf(">", spanStart + 5);
    if (tagEnd === -1) break;
    const attributes = parseQuotedHtmlAttributes(
      html.slice(spanStart, tagEnd + 1),
    );
    if (attributes.get("class")?.toLowerCase() !== "error") {
      cursor = tagEnd + 1;
      continue;
    }

    const closingStart = lowerHtml.indexOf("</span>", tagEnd + 1);
    if (closingStart === -1) break;
    const closingEnd = closingStart + "</span>".length;
    const filenameEnd = lowerHtml.indexOf("]", closingEnd);
    if (filenameEnd === -1) break;
    if (filenameEnd === closingEnd) {
      cursor = filenameEnd + 1;
      continue;
    }

    const rawFilename =
      html.slice(tagEnd + 1, closingStart) +
      html.slice(closingEnd, filenameEnd);
    const filename = stripHtmlTags(decodeHtmlAttribute(rawFilename)).trim();
    if (filename) filenames.push(filename);
    cursor = filenameEnd + 1;
  }
  return filenames;
};

const sameRenderedFilename = (
  sourceFilename: string,
  renderedFilename: string,
): boolean =>
  (() => {
    const source = sourceFilename.normalize("NFC");
    const rendered = renderedFilename.normalize("NFC");
    return (
      source === rendered ||
      source.startsWith(`${rendered} (`) ||
      rendered.startsWith(`${source} (`)
    );
  })();

export type JiraMediaResolutionStrategy =
  | "unique_filename"
  | "sole_attachment"
  | "rendered_element"
  | "rendered_unique_filename";

interface JiraMediaResolution {
  binding: AttachmentBinding;
  strategy: JiraMediaResolutionStrategy;
}

export const resolveJiraMediaReference = (
  media: AdfMediaReference,
  attachments: readonly AttachmentBinding[],
  renderedHtml: string,
  sourceAttachments: readonly NormalizedJiraAttachment[] = attachments.map(
    (item) => item.source,
  ),
): JiraMediaResolution | null => {
  if (media.mediaType !== "file") return null;
  const renderedHintMap = renderedHints(renderedHtml);
  const hint = renderedHintMap.get(media.mediaId);
  if (renderedHintMap.has(media.mediaId) && hint === null) return null;
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
  if (media.alt) {
    const candidates = sourceAttachments.filter(
      (item) => item.filename === media.alt,
    );
    if (candidates.length === 1) {
      if (hint?.attachmentId && hint.attachmentId !== candidates[0]?.id) {
        return null;
      }
      const binding = attachments.find(
        (item) => item.source.id === candidates[0]?.id,
      );
      return binding ? { binding, strategy: "unique_filename" } : null;
    }
  }
  if (sourceAttachments.length === 1) {
    if (hint?.attachmentId && hint.attachmentId !== sourceAttachments[0]?.id) {
      return null;
    }
    const binding = attachments.find(
      (item) => item.source.id === sourceAttachments[0]?.id,
    );
    return binding ? { binding, strategy: "sole_attachment" } : null;
  }
  if (hint?.attachmentId) {
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
  if (hint?.filename) {
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
  const legacyHints = renderedAttachmentHints(renderedHtml);
  const filenameHints = media.alt ?? media.filename;
  if (filenameHints) {
    const matchingHints = legacyHints.filter(
      (candidate) =>
        candidate.filename !== null &&
        sameRenderedFilename(candidate.filename, filenameHints),
    );
    if (matchingHints.length === 1) {
      const attachmentId = matchingHints[0]?.attachmentId;
      const candidates = attachmentId
        ? sourceAttachments.filter((item) => item.id === attachmentId)
        : sourceAttachments.filter((item) =>
            sameRenderedFilename(item.filename, filenameHints),
          );
      if (candidates.length === 1) {
        const binding = attachments.find(
          (item) => item.source.id === candidates[0]?.id,
        );
        if (binding) return { binding, strategy: "rendered_element" };
      }
    } else if (matchingHints.length > 1) {
      return null;
    }
  }
  const idHints = legacyHints.filter((candidate) => candidate.attachmentId);
  if (idHints.length === 1) {
    const attachmentId = idHints[0]?.attachmentId;
    const candidate = sourceAttachments.find(
      (item) => item.id === attachmentId,
    );
    if (candidate) {
      const binding = attachments.find(
        (item) => item.source.id === candidate.id,
      );
      if (binding) return { binding, strategy: "rendered_element" };
    }
  }
  const decodedRenderedHtml = decodeHtmlAttribute(renderedHtml);
  const renderedFilenameCandidates = sourceAttachments.filter(
    (item) =>
      item.filename.includes(media.mediaId) &&
      decodedRenderedHtml.includes(item.filename),
  );
  if (renderedFilenameCandidates.length === 1) {
    const candidate = renderedFilenameCandidates[0];
    const binding = attachments.find(
      (item) => item.source.id === candidate?.id,
    );
    if (binding) {
      return { binding, strategy: "rendered_unique_filename" };
    }
  }
  if (renderedFilenameCandidates.length > 1) return null;
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
  const directResolutions = converted.media.map((media) =>
    media.mediaType === "file"
      ? resolveJiraMediaReference(
          media,
          bindings,
          renderedHtml,
          sourceAttachments,
        )
      : null,
  );
  const unresolvedFileIndexes = converted.media.flatMap((media, index) =>
    media.mediaType === "file" && directResolutions[index] === null
      ? [index]
      : [],
  );
  const orderedFallbacks = new Map<number, JiraMediaResolution>();
  const errorFilenames = renderedErrorAttachmentFilenames(renderedHtml);
  if (
    unresolvedFileIndexes.length > 0 &&
    unresolvedFileIndexes.length === errorFilenames.length
  ) {
    const usedAttachmentIds = new Set<string>();
    let deterministic = true;
    for (const [position, filename] of errorFilenames.entries()) {
      const candidates = sourceAttachments.filter((attachment) =>
        sameRenderedFilename(attachment.filename, filename),
      );
      const binding =
        candidates.length === 1
          ? bindings.find((item) => item.source.id === candidates[0]?.id)
          : undefined;
      const mediaIndex = unresolvedFileIndexes[position];
      if (
        candidates.length !== 1 ||
        !binding ||
        usedAttachmentIds.has(binding.source.id) ||
        mediaIndex === undefined
      ) {
        deterministic = false;
        break;
      }
      usedAttachmentIds.add(binding.source.id);
      orderedFallbacks.set(mediaIndex, {
        binding,
        strategy: "rendered_unique_filename",
      });
    }
    if (!deterministic) orderedFallbacks.clear();
  }
  for (const [mediaIndex, media] of converted.media.entries()) {
    legacyPreRewriteMarkdown = legacyPreRewriteMarkdown.replace(
      media.placeholder,
      media.legacyPlaceholder,
    );
    report.media.total += 1;
    // External media (for example Jira's embedded GitHub icon) has no Jira
    // attachment bytes to import. Keep its opaque raw placeholder without
    // turning it into a false crosswalk failure.
    if (media.mediaType !== "file") continue;
    const resolution =
      directResolutions[mediaIndex] ?? orderedFallbacks.get(mediaIndex) ?? null;
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
        ...(resolution.binding.previousFileUris ?? []),
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
