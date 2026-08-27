import { type MentionToken, parseMentionTokens } from "@reef/core";

interface MdastPosition {
  start: { offset?: number };
  end: { offset?: number };
}

interface MdastNode {
  type: string;
  value?: string;
  data?: { hProperties?: Record<string, unknown>; hName?: string };
  children?: MdastNode[];
  position?: MdastPosition;
}

interface VFileLike {
  value?: unknown;
  toString?: () => string;
}

export interface CommentMentionOptions {
  /** Names in the persisted recipient projection receive mention styling. */
  knownUsernames: ReadonlySet<string>;
  /** Changes when the body/projection changes so Streamdown rebuilds its cache. */
  cacheFingerprint?: string;
}

/**
 * CommonMark renders a consecutive `\\` run as one literal backslash. Comment
 * bodies preserve the authored run, so double only runs of two or more before
 * handing the source to the Markdown renderer. A single `\\@` remains the
 * existing ordinary-mention escape.
 */
export function preserveCommentBackslashRuns(value: string): string {
  return value.replace(/\\{2,}/g, (run) => run + run);
}

const MARKDOWN_ESCAPABLE = new Set([
  "!",
  '"',
  "#",
  "$",
  "%",
  "&",
  "'",
  "(",
  ")",
  "*",
  "+",
  ",",
  "-",
  ".",
  "/",
  ":",
  ";",
  "<",
  "=",
  ">",
  "?",
  "@",
  "[",
  "\\",
  "]",
  "^",
  "_",
  "`",
  "{",
  "|",
  "}",
  "~",
]);

/**
 * Turn source offsets into offsets in the cooked text value mdast gives us.
 * In particular, CommonMark removes the backslash from `\@alice` and from
 * escaped braces inside a braced mention. The source parser decides whether the
 * token is a mention, while this map keeps replacement
 * offsets aligned with the mdast value.
 */
function cookedOffsetMap(source: string): number[] {
  const offsets = new Array<number>(source.length + 1).fill(0);
  let cooked = 0;
  let cursor = 0;
  while (cursor < source.length) {
    offsets[cursor] = cooked;
    if (
      source[cursor] === "\\" &&
      MARKDOWN_ESCAPABLE.has(source[cursor + 1] ?? "")
    ) {
      offsets[cursor + 1] = cooked;
      cooked += 1;
      cursor += 2;
      offsets[cursor] = cooked;
      continue;
    }
    cooked += 1;
    cursor += 1;
    offsets[cursor] = cooked;
  }
  return offsets;
}

function mentionNode(token: MentionToken): MdastNode {
  return {
    // mdast-util-to-hast applies hName/hProperties to element nodes. A text
    // node's data is ignored there, so use a non-interactive strong node and
    // override its output tag to span. Notifications and profile routes are
    // out of scope for REEF-452.
    type: "strong",
    children: [{ type: "text", value: `@${token.username}` }],
    data: {
      hName: "span",
      hProperties: {
        dataReefMention: token.username,
      },
    },
  };
}

function splitTextByTokens(
  value: string,
  source: string,
  tokens: readonly MentionToken[],
  options: CommentMentionOptions,
): MdastNode[] {
  const map = cookedOffsetMap(source);
  const out: MdastNode[] = [];
  let cookedCursor = 0;

  for (const token of tokens) {
    if (!options.knownUsernames.has(token.username)) continue;
    const rawStart = Math.max(0, Math.min(token.start, source.length));
    const rawEnd = Math.max(rawStart, Math.min(token.end, source.length));
    const cookedStart = Math.min(map[rawStart] ?? rawStart, value.length);
    const cookedEnd = Math.min(map[rawEnd] ?? rawEnd, value.length);
    if (cookedEnd <= cookedStart || cookedStart < cookedCursor) continue;
    if (cookedStart > cookedCursor) {
      out.push({ type: "text", value: value.slice(cookedCursor, cookedStart) });
    }
    out.push(mentionNode(token));
    cookedCursor = cookedEnd;
  }

  if (out.length === 0) return [{ type: "text", value }];
  if (cookedCursor < value.length) {
    out.push({ type: "text", value: value.slice(cookedCursor) });
  }
  return out;
}

function splitTextFallback(
  value: string,
  options: CommentMentionOptions,
): MdastNode[] {
  return splitTextByTokens(value, value, parseMentionTokens(value), options);
}

/**
 * Style resolved comment mentions on mdast text nodes. Markdown-owned
 * nodes (inline/fenced code and links) are intentionally not traversed; the
 * source parser additionally excludes emails and escaped/unresolved tokens.
 */
export function remarkCommentMentions(options: CommentMentionOptions) {
  return (tree: MdastNode, file?: VFileLike): void => {
    const source =
      typeof file?.value === "string"
        ? file.value
        : typeof file?.toString === "function"
          ? file.toString()
          : undefined;
    const tokens = source ? parseMentionTokens(source) : [];
    transform(tree, source, tokens, options);
  };
}

function transform(
  node: MdastNode,
  source: string | undefined,
  tokens: readonly MentionToken[],
  options: CommentMentionOptions,
): void {
  if (node.type === "link" || !node.children) return;
  const next: MdastNode[] = [];
  for (const child of node.children) {
    if (child.type !== "text" || typeof child.value !== "string") {
      transform(child, source, tokens, options);
      next.push(child);
      continue;
    }

    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (
      source !== undefined &&
      start !== undefined &&
      end !== undefined &&
      start >= 0 &&
      end >= start
    ) {
      const childTokens = tokens
        .filter((token) => token.start >= start && token.end <= end)
        .map((token) => ({
          ...token,
          start: token.start - start,
          end: token.end - start,
        }));
      next.push(
        ...splitTextByTokens(
          child.value,
          source.slice(start, end),
          childTokens,
          options,
        ),
      );
    } else {
      next.push(...splitTextFallback(child.value, options));
    }
  }
  node.children = next;
}
