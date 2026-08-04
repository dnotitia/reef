import {
  type VaultMember,
  formatMentionToken,
  parseMentionTokens,
} from "@reef/core";

export interface CommentMentionDraftToken {
  username: string;
  raw: string;
  /** UTF-16 offsets into the user-visible draft text. */
  start: number;
  end: number;
  /** True only for a roster identity that can be serialized as a mention. */
  resolved: boolean;
}

export interface CommentMentionDraft {
  text: string;
  tokens: readonly CommentMentionDraftToken[];
}

export interface MentionContext {
  start: number;
  query: string;
}

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const SAFE_QUERY = /^[\p{L}\p{N}]*$/u;

export function emptyCommentMentionDraft(): CommentMentionDraft {
  return { text: "", tokens: [] };
}

/**
 * Remove the save-boundary escape from ordinary persisted @ text while
 * leaving Markdown-owned and already-escaped regions untouched. The probe
 * reuses the core parser instead of introducing another Markdown grammar.
 */
function unescapePersistedOrdinaryAt(value: string): string {
  let cursor = 0;
  let visible = "";

  for (let index = 0; index < value.length - 1; index += 1) {
    if (value[index] !== "\\" || value[index + 1] !== "@") continue;

    const probe = `${value.slice(0, index)}@${value.slice(index + 2)}`;
    const token = parseMentionTokens(probe).find(
      (candidate) => candidate.start === index,
    );
    if (!token) continue;

    visible += value.slice(cursor, index);
    visible += "@";
    cursor = index + 2;
    index += 1;
  }

  return visible + value.slice(cursor);
}

/**
 * Build the editable, syntax-free view of a persisted comment. Every parsed
 * token gets a backing raw value so an unresolved or legacy token survives a
 * no-op edit, while the visible draft never exposes canonical braces.
 */
export function draftFromPersistedComment(
  body: string,
  persistedRecipients: ReadonlySet<string>,
): CommentMentionDraft {
  const parsed = parseMentionTokens(body);
  if (parsed.length === 0) {
    return { text: unescapePersistedOrdinaryAt(body), tokens: [] };
  }

  const parts: string[] = [];
  const tokens: CommentMentionDraftToken[] = [];
  let sourceCursor = 0;
  let visibleCursor = 0;

  for (const token of parsed) {
    const before = body.slice(sourceCursor, token.start);
    const visibleBefore = unescapePersistedOrdinaryAt(before);
    parts.push(visibleBefore);
    visibleCursor += visibleBefore.length;

    const visible = `@${token.username}`;
    parts.push(visible);
    tokens.push({
      username: token.username,
      raw: token.raw,
      start: visibleCursor,
      end: visibleCursor + visible.length,
      resolved: persistedRecipients.has(token.username),
    });
    visibleCursor += visible.length;
    sourceCursor = token.end;
  }

  const after = body.slice(sourceCursor);
  parts.push(unescapePersistedOrdinaryAt(after));
  return { text: parts.join(""), tokens };
}

/**
 * Serialize identities while escaping every other syntactic @ token as
 * ordinary text. This keeps the core fail-closed validator unchanged while
 * allowing users to edit a mention label into normal prose.
 */
export function serializeCommentMentionDraft(
  draft: CommentMentionDraft,
): string {
  const tokens = [...draft.tokens].sort(
    (left, right) => left.start - right.start,
  );
  const validTokens = tokens.filter(
    (token) =>
      token.start >= 0 &&
      token.end <= draft.text.length &&
      draft.text.slice(token.start, token.end) === `@${token.username}`,
  );
  const ordinaryStarts = parseMentionTokens(draft.text)
    .filter(
      (token) =>
        !validTokens.some(
          (active) => token.start >= active.start && token.start < active.end,
        ),
    )
    .map((token) => token.start)
    .sort((left, right) => left - right);

  if (validTokens.length === 0 && ordinaryStarts.length === 0) {
    return draft.text;
  }

  let cursor = 0;
  let serialized = "";
  const events = [
    ...validTokens.map((token) => ({ kind: "token" as const, token })),
    ...ordinaryStarts.map((start) => ({ kind: "literal" as const, start })),
  ].sort((left, right) => {
    const leftStart = left.kind === "token" ? left.token.start : left.start;
    const rightStart = right.kind === "token" ? right.token.start : right.start;
    return leftStart - rightStart;
  });

  for (const event of events) {
    if (event.kind === "token") {
      const token = event.token;
      if (token.start < cursor) continue;
      serialized += draft.text.slice(cursor, token.start);
      serialized += token.raw;
      cursor = token.end;
      continue;
    }
    if (event.start < cursor) continue;
    serialized += draft.text.slice(cursor, event.start);
    serialized += "\\@";
    cursor = event.start + 1;
  }
  return serialized + draft.text.slice(cursor);
}

/**
 * Rebase identities across a normal textarea edit. Any edit intersecting a
 * mention label invalidates that identity; edits strictly before/after it are
 * shifted without touching the user's visible text.
 */
export function updateCommentMentionDraft(
  previous: CommentMentionDraft,
  nextText: string,
): CommentMentionDraft {
  if (previous.text === nextText) return previous;

  let prefix = 0;
  const maxPrefix = Math.min(previous.text.length, nextText.length);
  while (prefix < maxPrefix && previous.text[prefix] === nextText[prefix]) {
    prefix += 1;
  }

  let previousEnd = previous.text.length;
  let nextEnd = nextText.length;
  while (
    previousEnd > prefix &&
    nextEnd > prefix &&
    previous.text[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  const delta = nextEnd - previousEnd;
  const tokens = previous.tokens.flatMap((token) => {
    if (token.end <= prefix) return [token];
    if (token.start >= previousEnd) {
      return [{ ...token, start: token.start + delta, end: token.end + delta }];
    }
    return [];
  });

  return { text: nextText, tokens };
}

/** Insert a visible label and retain its exact roster identity for save time. */
export function selectCommentMention(
  draft: CommentMentionDraft,
  member: Pick<VaultMember, "username">,
  start: number,
  end: number,
): CommentMentionDraft {
  const safeStart = Math.max(0, Math.min(start, draft.text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, draft.text.length));
  const visible = `@${member.username}`;
  const nextText = `${draft.text.slice(0, safeStart)}${visible} ${draft.text.slice(
    safeEnd,
  )}`;
  const rebased = updateCommentMentionDraft(draft, nextText);
  const selected: CommentMentionDraftToken = {
    username: member.username,
    raw: formatMentionToken(member.username),
    start: safeStart,
    end: safeStart + visible.length,
    resolved: true,
  };
  return {
    text: nextText,
    tokens: [...rebased.tokens, selected].sort(
      (left, right) => left.start - right.start,
    ),
  };
}

function previousCodePoint(value: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const previousIndex = index - 1;
  const codePoint = value.codePointAt(previousIndex);
  if (codePoint === undefined) return undefined;
  const start = previousIndex - (codePoint > 0xffff ? 1 : 0);
  return value.slice(start, index);
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

/** Visible autocomplete only accepts the delimiter-safe query the user typed. */
export function mentionContextAt(
  value: string,
  caret: number,
): MentionContext | null {
  const beforeCaret = value.slice(0, caret);
  const start = beforeCaret.lastIndexOf("@");
  if (start < 0 || isEscaped(beforeCaret, start)) return null;
  const previous = previousCodePoint(beforeCaret, start);
  if (previous === "@" || LETTER_OR_NUMBER.test(previous ?? "")) return null;

  const fragment = beforeCaret.slice(start + 1);
  if (fragment.includes("\n") || fragment.includes("\r")) return null;
  if (!SAFE_QUERY.test(fragment)) return null;
  return { start, query: fragment };
}

export function commentMentionSuggestions(
  members: readonly VaultMember[],
  context: MentionContext | null,
): VaultMember[] {
  if (!context) return [];
  const query = context.query.trim().toLocaleLowerCase();
  return members
    .filter((member) => {
      if (!query) return true;
      return (
        member.username.toLocaleLowerCase().includes(query) ||
        (member.display_name?.toLocaleLowerCase().includes(query) ?? false)
      );
    })
    .slice(0, 8);
}
