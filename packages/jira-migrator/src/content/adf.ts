import {
  type JiraAccountMappingArtifact,
  type ReefActorDirectoryEntry,
  resolveJiraActor,
} from "../accounts/mapping.js";
import type { RawArchiveReference } from "../rawArchive.js";
import { deepFreeze, isPlainObject } from "../shared/objects.js";

export interface AdfConversionReport {
  classification: "mapped" | "preserved" | "unsupported";
  path: string;
  nodeType: string;
  reason: string;
  rawArchiveReference?: RawArchiveReference;
}

export interface AdfMediaReference {
  path: string;
  mediaId: string;
  mediaType: string | null;
  collection: string | null;
  filename: string | null;
  rawArchiveReference: RawArchiveReference | null;
  placeholder: string;
  legacyPlaceholder: string;
}

export interface AdfToMarkdownResult {
  markdown: string;
  reports: readonly AdfConversionReport[];
  media: readonly AdfMediaReference[];
}

export interface AdfToMarkdownOptions {
  accountMapping?: {
    artifact: JiraAccountMappingArtifact;
    directory?: readonly ReefActorDirectoryEntry[];
  };
  descriptionRawArchiveReference?: RawArchiveReference;
  mediaRawArchiveReferences?: Readonly<Record<string, RawArchiveReference>>;
}

interface RenderContext {
  reports: AdfConversionReport[];
  media: AdfMediaReference[];
  options: AdfToMarkdownOptions;
  listDepth: number;
}

const escapeText = (value: string): string =>
  value.replace(/([\\`*_{}\[\]()<>#+.!|~-])/gu, "\\$1");

const escapeInlineSourceText = (value: string): string =>
  escapeText(value.replace(/\s+/gu, " ").trim());

const longestBacktickSequence = (value: string): number => {
  let longestBacktickRun = 0;
  let currentBacktickRun = 0;
  for (const character of value) {
    if (character === "`") {
      currentBacktickRun += 1;
      longestBacktickRun = Math.max(longestBacktickRun, currentBacktickRun);
    } else {
      currentBacktickRun = 0;
    }
  }
  return longestBacktickRun;
};

const renderInlineCode = (value: string): string => {
  const longestBacktickRun = longestBacktickSequence(value);
  const fence = "`".repeat(longestBacktickRun + 1);
  return `${fence} ${value} ${fence}`;
};

const markdownFence = (
  line: string,
): { length: number; suffix: string } | null => {
  let index = 0;
  while (index < line.length && index < 3 && line[index] === " ") index += 1;
  const fenceStart = index;
  while (index < line.length && line[index] === "`") index += 1;
  const length = index - fenceStart;
  return length >= 3 ? { length, suffix: line.slice(index) } : null;
};

const normalizeHorizontalWhitespaceBeforeNewlines = (value: string): string => {
  const chunks: string[] = [];
  let lineStart = 0;
  let openFenceLength: number | null = null;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "\n") continue;
    const line = value.slice(lineStart, index);
    const fence = markdownFence(line);
    if (openFenceLength !== null) {
      chunks.push(line, "\n");
      if (
        fence &&
        fence.length >= openFenceLength &&
        fence.suffix.trim().length === 0
      ) {
        openFenceLength = null;
      }
    } else if (fence) {
      openFenceLength = fence.length;
      chunks.push(line, "\n");
    } else {
      let lineEnd = line.length;
      while (
        lineEnd > 0 &&
        (line[lineEnd - 1] === " " || line[lineEnd - 1] === "\t")
      ) {
        lineEnd -= 1;
      }
      chunks.push(line.slice(0, lineEnd), line.endsWith("  ") ? "  \n" : "\n");
    }
    lineStart = index + 1;
  }
  chunks.push(value.slice(lineStart));
  return chunks.join("");
};

const rawReferenceToken = (reference: RawArchiveReference): string =>
  `${reference.runId}/${reference.entryId}@${reference.contentSha256}`;

const safeMarkdownHref = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  if (/^akb:\/\//iu.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return url.protocol === "akb:" && url.host && url.pathname !== "/"
        ? trimmed
        : null;
    } catch {
      return null;
    }
  }
  if (/^(https?:|mailto:)/iu.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return ["http:", "https:", "mailto:"].includes(url.protocol)
        ? trimmed
        : null;
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) return null;
  try {
    return new URL(`https://${trimmed}`).toString();
  } catch {
    return null;
  }
};

const escapeMarkdownHref = (href: string): string =>
  href.replace(/[\\()<>\s]/gu, (character) => {
    switch (character) {
      case "(":
        return "%28";
      case ")":
        return "%29";
      case "<":
        return "%3C";
      case ">":
        return "%3E";
      case "\\":
        return "%5C";
      default:
        return encodeURIComponent(character);
    }
  });

const nodeType = (node: Readonly<Record<string, unknown>>): string =>
  typeof node.type === "string" ? node.type : "unknown";

const childNodes = (
  node: Readonly<Record<string, unknown>>,
): readonly unknown[] => (Array.isArray(node.content) ? node.content : []);

const attrs = (
  node: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> =>
  isPlainObject(node.attrs) ? node.attrs : {};

const applyMarks = (
  text: string,
  marks: unknown,
  path: string,
  context: RenderContext,
): string => {
  if (!Array.isArray(marks)) return escapeText(text);
  const containsCodeMark = marks.some(
    (mark) => isPlainObject(mark) && mark.type === "code",
  );
  let rendered = containsCodeMark ? text : escapeText(text);
  for (const [index, rawMark] of marks.entries()) {
    if (!isPlainObject(rawMark) || typeof rawMark.type !== "string") continue;
    const markPath = `${path}.marks[${index}]`;
    const markAttrs = isPlainObject(rawMark.attrs) ? rawMark.attrs : {};
    switch (rawMark.type) {
      case "strong":
        rendered = `**${rendered}**`;
        break;
      case "em":
        rendered = `_${rendered}_`;
        break;
      case "strike":
        rendered = `~~${rendered}~~`;
        break;
      case "code":
        rendered = renderInlineCode(rendered);
        break;
      case "link": {
        const href =
          typeof markAttrs.href === "string"
            ? safeMarkdownHref(markAttrs.href)
            : null;
        if (href) {
          rendered = `[${rendered}](${escapeMarkdownHref(href)})`;
        } else {
          context.reports.push({
            classification: "unsupported",
            path: markPath,
            nodeType: "mark:link",
            reason: "link_href_unsafe",
            ...(context.options.descriptionRawArchiveReference
              ? {
                  rawArchiveReference:
                    context.options.descriptionRawArchiveReference,
                }
              : {}),
          });
        }
        break;
      }
      case "underline":
        context.reports.push({
          classification: "preserved",
          path: markPath,
          nodeType: "mark:underline",
          reason: "Markdown has no portable underline syntax; text preserved",
        });
        break;
      case "subsup":
      case "textColor":
      case "backgroundColor":
      case "annotation":
        context.reports.push({
          classification: "preserved",
          path: markPath,
          nodeType: `mark:${rawMark.type}`,
          reason: "text preserved without non-portable visual mark",
        });
        break;
      default:
        context.reports.push({
          classification: "unsupported",
          path: markPath,
          nodeType: `mark:${rawMark.type}`,
          reason: "description_mark_unsupported",
          ...(context.options.descriptionRawArchiveReference
            ? {
                rawArchiveReference:
                  context.options.descriptionRawArchiveReference,
              }
            : {}),
        });
    }
  }
  return rendered;
};

const renderChildren = (
  node: Readonly<Record<string, unknown>>,
  path: string,
  context: RenderContext,
): string =>
  childNodes(node)
    .map((child, index) =>
      renderNode(child, `${path}.content[${index}]`, context),
    )
    .join("");

const renderList = (
  node: Readonly<Record<string, unknown>>,
  path: string,
  context: RenderContext,
  ordered: boolean,
): string => {
  const start = Number(attrs(node).order ?? 1);
  return childNodes(node)
    .map((child, index) => {
      const rendered = renderNode(child, `${path}.content[${index}]`, {
        ...context,
        listDepth: context.listDepth + 1,
      }).trim();
      const prefix = ordered ? `${start + index}. ` : "- ";
      const indent = "  ".repeat(context.listDepth);
      return `${indent}${prefix}${rendered.replace(/\n/gu, `\n${indent}  `)}`;
    })
    .join("\n");
};

const renderTableCell = (
  node: Readonly<Record<string, unknown>>,
  path: string,
  context: RenderContext,
): string => renderChildren(node, path, context).trim().replace(/\n+/gu, " ");

const renderTable = (
  node: Readonly<Record<string, unknown>>,
  path: string,
  context: RenderContext,
): string => {
  const rows = childNodes(node).map((rawRow, rowIndex) => {
    if (!isPlainObject(rawRow)) return [];
    return childNodes(rawRow).map((rawCell, cellIndex) =>
      isPlainObject(rawCell)
        ? renderTableCell(
            rawCell,
            `${path}.content[${rowIndex}].content[${cellIndex}]`,
            context,
          )
        : "",
    );
  });
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) =>
    Array.from({ length: width }, (_, index) => row[index] ?? ""),
  );
  const header = normalized[0] ?? [];
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
};

const renderMedia = (
  node: Readonly<Record<string, unknown>>,
  path: string,
  context: RenderContext,
): string => {
  const mediaAttrs = attrs(node);
  const id = typeof mediaAttrs.id === "string" ? mediaAttrs.id : "unknown";
  const type = typeof mediaAttrs.type === "string" ? mediaAttrs.type : null;
  const collection =
    typeof mediaAttrs.collection === "string" ? mediaAttrs.collection : null;
  const filename =
    typeof mediaAttrs.filename === "string" && mediaAttrs.filename.trim()
      ? mediaAttrs.filename.trim()
      : null;
  const reference = context.options.mediaRawArchiveReferences?.[id] ?? null;
  const token = reference ? rawReferenceToken(reference) : "missing";
  const legacyPlaceholder = escapeInlineSourceText(
    `[Jira media ${id} (${type ?? "unknown"}) raw:${token}]`,
  );
  const safeEncode = (value: string): string =>
    encodeURIComponent(
      Array.from(value, (character) =>
        character.length === 1 &&
        character.charCodeAt(0) >= 0xd800 &&
        character.charCodeAt(0) <= 0xdfff
          ? "\ufffd"
          : character,
      ).join(""),
    );
  const placeholder = `\u{e000}jira-media:${safeEncode(path)}:${safeEncode(id)}:${safeEncode(token)}\u{e001}`;
  context.media.push({
    path,
    mediaId: id,
    mediaType: type,
    collection,
    filename,
    rawArchiveReference: reference,
    placeholder,
    legacyPlaceholder,
  });
  context.reports.push({
    classification: "preserved",
    path,
    nodeType: nodeType(node),
    reason: reference
      ? "media preserved as a stable placeholder for later rewrite"
      : "media placeholder is missing its raw archive reference",
    ...(reference ? { rawArchiveReference: reference } : {}),
  });
  return placeholder;
};

function renderNode(
  rawNode: unknown,
  path: string,
  context: RenderContext,
): string {
  if (!isPlainObject(rawNode)) {
    context.reports.push({
      classification: "unsupported",
      path,
      nodeType: "invalid",
      reason: "description_node_unsupported",
      ...(context.options.descriptionRawArchiveReference
        ? {
            rawArchiveReference: context.options.descriptionRawArchiveReference,
          }
        : {}),
    });
    return "";
  }
  const type = nodeType(rawNode);
  const nodeAttrs = attrs(rawNode);
  switch (type) {
    case "doc":
      return renderChildren(rawNode, path, context).trim();
    case "text": {
      const value = typeof rawNode.text === "string" ? rawNode.text : "";
      return applyMarks(value, rawNode.marks, path, context);
    }
    case "paragraph":
      return `${renderChildren(rawNode, path, context)}\n\n`;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(nodeAttrs.level ?? 1)));
      return `${"#".repeat(level)} ${renderChildren(rawNode, path, context)}\n\n`;
    }
    case "hardBreak":
      return "  \n";
    case "bulletList":
      return `${renderList(rawNode, path, context, false)}\n\n`;
    case "orderedList":
      return `${renderList(rawNode, path, context, true)}\n\n`;
    case "listItem":
      return renderChildren(rawNode, path, context).trim();
    case "taskList":
      return `${childNodes(rawNode)
        .map((child, index) =>
          renderNode(child, `${path}.content[${index}]`, context),
        )
        .join("\n")}\n\n`;
    case "taskItem": {
      const checked = nodeAttrs.state === "DONE" ? "x" : " ";
      return `${"  ".repeat(context.listDepth)}- [${checked}] ${renderChildren(rawNode, path, context).trim()}`;
    }
    case "blockquote":
      return `${renderChildren(rawNode, path, context)
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    case "codeBlock": {
      const body = childNodes(rawNode)
        .map((child) =>
          isPlainObject(child) && typeof child.text === "string"
            ? child.text
            : "",
        )
        .join("");
      const requestedLanguage =
        typeof nodeAttrs.language === "string" ? nodeAttrs.language : "";
      const language = /^[a-z0-9_+.-]{1,64}$/iu.test(requestedLanguage)
        ? requestedLanguage
        : "";
      if (requestedLanguage && !language) {
        context.reports.push({
          classification: "preserved",
          path,
          nodeType: "codeBlock",
          reason: "code_language_sanitized",
          ...(context.options.descriptionRawArchiveReference
            ? {
                rawArchiveReference:
                  context.options.descriptionRawArchiveReference,
              }
            : {}),
        });
      }
      const longestBacktickRun = longestBacktickSequence(body);
      const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
      return `${fence}${language}\n${body}\n${fence}\n\n`;
    }
    case "rule":
      return "---\n\n";
    case "table":
      return `${renderTable(rawNode, path, context)}\n\n`;
    case "tableRow":
    case "tableHeader":
    case "tableCell":
      return renderChildren(rawNode, path, context);
    case "emoji":
      return typeof nodeAttrs.text === "string"
        ? escapeInlineSourceText(nodeAttrs.text)
        : typeof nodeAttrs.shortName === "string"
          ? escapeInlineSourceText(nodeAttrs.shortName)
          : "";
    case "mention": {
      const label =
        typeof nodeAttrs.text === "string" ? nodeAttrs.text : "@user";
      const accountId =
        typeof nodeAttrs.id === "string" ? nodeAttrs.id : undefined;
      if (!context.options.accountMapping || !accountId) {
        context.reports.push({
          classification: "preserved",
          path,
          nodeType: "mention",
          reason: "mention_unmapped",
          ...(context.options.descriptionRawArchiveReference
            ? {
                rawArchiveReference:
                  context.options.descriptionRawArchiveReference,
              }
            : {}),
        });
        return "@jira\\-user";
      }
      const mapped = resolveJiraActor(
        "mention",
        { accountId, displayName: label.replace(/^@/u, "") },
        context.options.accountMapping,
      );
      const hasSafeActor =
        mapped.actor !== null && mapped.strategy !== "fallback";
      context.reports.push({
        classification: hasSafeActor ? "mapped" : "preserved",
        path,
        nodeType: "mention",
        reason: hasSafeActor
          ? `mention_actor:${mapped.strategy}`
          : "mention_unmapped",
      });
      return hasSafeActor
        ? escapeInlineSourceText(`@${mapped.actor}`)
        : "@jira\\-user";
    }
    case "inlineCard":
    case "blockCard": {
      const url =
        typeof nodeAttrs.url === "string"
          ? safeMarkdownHref(nodeAttrs.url)
          : null;
      if (!url) {
        context.reports.push({
          classification: "unsupported",
          path,
          nodeType: type,
          reason: "card_url_unsafe",
          ...(context.options.descriptionRawArchiveReference
            ? {
                rawArchiveReference:
                  context.options.descriptionRawArchiveReference,
              }
            : {}),
        });
        return type === "blockCard"
          ? "[Unsupported Jira card URL]\n\n"
          : "[Unsupported Jira card URL]";
      }
      const renderedUrl = escapeMarkdownHref(url);
      return type === "blockCard" ? `${renderedUrl}\n\n` : renderedUrl;
    }
    case "status":
      return typeof nodeAttrs.text === "string"
        ? `**${escapeInlineSourceText(nodeAttrs.text)}**`
        : "";
    case "expand":
    case "nestedExpand": {
      const title =
        typeof nodeAttrs.title === "string" ? nodeAttrs.title : "Details";
      return `### ${escapeInlineSourceText(title)}\n\n${renderChildren(rawNode, path, context)}`;
    }
    case "media":
    case "mediaInline":
    case "file":
      return renderMedia(rawNode, path, context);
    case "mediaSingle":
    case "mediaGroup":
      return `${renderChildren(rawNode, path, context)}\n\n`;
    default:
      context.reports.push({
        classification: "unsupported",
        path,
        nodeType: type,
        reason: "description_node_unsupported",
        ...(context.options.descriptionRawArchiveReference
          ? {
              rawArchiveReference:
                context.options.descriptionRawArchiveReference,
            }
          : {}),
      });
      return renderChildren(rawNode, path, context);
  }
}

export const convertAdfToMarkdown = (
  adf: unknown,
  options: AdfToMarkdownOptions = {},
): AdfToMarkdownResult => {
  const context: RenderContext = {
    reports: [],
    media: [],
    options,
    listDepth: 0,
  };
  const markdown = normalizeHorizontalWhitespaceBeforeNewlines(
    renderNode(adf, "$", context),
  )
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return deepFreeze({
    markdown,
    reports: context.reports,
    media: context.media,
  });
};
