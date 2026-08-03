import { z } from "zod";

/** A username may use the compact token form only when every code point is a
 * Unicode letter or number. */
export const DELIMITER_SAFE_USERNAME_PATTERN = /^[\p{L}\p{N}]+$/u;

export const MentionUsernameSchema = z.string().min(1);
export const MentionRecipientsSchema = z.array(MentionUsernameSchema);

export interface MentionToken {
  username: string;
  raw: string;
  start: number;
  end: number;
}

export const MentionTokenSchema = z.object({
  username: MentionUsernameSchema,
  raw: z.string().min(2),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const EMAIL_PATTERN =
  /[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+/gu;

interface Range {
  start: number;
  end: number;
}

function isLetterOrNumber(value: string | undefined): boolean {
  return value !== undefined && LETTER_OR_NUMBER.test(value);
}

function codePointAt(value: string, index: number): string | undefined {
  const codePoint = value.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function codePointWidth(value: string, index: number): number {
  const codePoint = value.codePointAt(index);
  return codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
}

function previousCodePoint(value: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const previousIndex = index - 1;
  const codePoint = value.codePointAt(previousIndex);
  if (codePoint === undefined) return undefined;
  const start = previousIndex - (codePoint > 0xffff ? 1 : 0);
  return value.slice(start, index);
}

function isLetterOrNumberAt(value: string, index: number): boolean {
  return isLetterOrNumber(codePointAt(value, index));
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

function rangeContains(ranges: readonly Range[], index: number): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function lineEnd(value: string, start: number): number {
  const newline = value.indexOf("\n", start);
  return newline === -1 ? value.length : newline;
}

function collectFencedCodeRanges(value: string): Range[] {
  const ranges: Range[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const end = lineEnd(value, cursor);
    const line = value.slice(cursor, end);
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (!opening) {
      cursor = end + 1;
      continue;
    }

    const fence = opening[1]?.[0];
    const length = opening[1]?.length ?? 0;
    let closingCursor = end + 1;
    let closingEnd = value.length;
    while (closingCursor < value.length) {
      const candidateEnd = lineEnd(value, closingCursor);
      const candidate = value.slice(closingCursor, candidateEnd);
      if (new RegExp(`^ {0,3}${fence}{${length},}\\s*$`, "u").test(candidate)) {
        closingEnd = candidateEnd;
        break;
      }
      closingCursor = candidateEnd + 1;
    }
    ranges.push({ start: cursor, end: closingEnd });
    cursor = closingEnd + 1;
  }
  return ranges;
}

function collectInlineCodeRanges(
  value: string,
  fenced: readonly Range[],
): Range[] {
  const ranges: Range[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    if (rangeContains(fenced, cursor) || value[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    let openingEnd = cursor;
    while (value[openingEnd] === "`") openingEnd += 1;
    const marker = value.slice(cursor, openingEnd);
    const closing = value.indexOf(marker, openingEnd);
    const end = closing === -1 ? value.length : closing + marker.length;
    ranges.push({ start: cursor, end });
    cursor = end;
  }
  return ranges;
}

function findUnescaped(
  value: string,
  character: string,
  start: number,
): number {
  for (let cursor = start; cursor < value.length; cursor += 1) {
    if (value[cursor] === character && !isEscaped(value, cursor)) return cursor;
  }
  return -1;
}

function collectMarkdownLinkRanges(value: string): Range[] {
  const ranges: Range[] = [];
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    if (value[cursor] !== "[" || isEscaped(value, cursor)) continue;
    const labelEnd = findUnescaped(value, "]", cursor + 1);
    if (labelEnd === -1) continue;
    const next = value[labelEnd + 1];
    if (next === "(") {
      let depth = 1;
      let close = labelEnd + 2;
      for (; close < value.length; close += 1) {
        if (isEscaped(value, close)) continue;
        if (value[close] === "(") depth += 1;
        if (value[close] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth === 0) ranges.push({ start: cursor, end: close + 1 });
    } else if (next === "[") {
      const referenceEnd = findUnescaped(value, "]", labelEnd + 2);
      if (referenceEnd !== -1) {
        ranges.push({ start: cursor, end: referenceEnd + 1 });
      }
    }
  }
  return ranges;
}

function collectEmailRanges(value: string): Range[] {
  const ranges: Range[] = [];
  const pattern = new RegExp(EMAIL_PATTERN.source, EMAIL_PATTERN.flags);
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
}

function unescapeBracedUsername(value: string): string {
  let result = "";
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    if (
      value[cursor] === "\\" &&
      (value[cursor + 1] === "\\" || value[cursor + 1] === "}")
    ) {
      result += value[cursor + 1];
      cursor += 1;
    } else {
      result += value[cursor];
    }
  }
  return result;
}

function parseAt(value: string, start: number): MentionToken | null {
  if (isEscaped(value, start)) return null;
  const previous = previousCodePoint(value, start);
  if (previous === "@" || isLetterOrNumber(previous)) return null;

  if (value[start + 1] === "{") {
    const close = findUnescaped(value, "}", start + 2);
    if (close === -1) return null;
    const username = unescapeBracedUsername(value.slice(start + 2, close));
    if (!username || username.includes("\n") || username.includes("\r")) {
      return null;
    }
    return {
      username,
      raw: value.slice(start, close + 1),
      start,
      end: close + 1,
    };
  }

  if (!isLetterOrNumberAt(value, start + 1)) return null;
  let end = start + 1;
  while (isLetterOrNumberAt(value, end)) end += codePointWidth(value, end);
  // A backslash or a second @ immediately after the compact token means the
  // author is typing an unsafe username; that username must use braces.
  if (value[end] === "\\" || value[end] === "@") return null;
  const username = value.slice(start + 1, end);
  return { username, raw: value.slice(start, end), start, end };
}

/** Returns the canonical token the composer should insert for a roster username. */
export function formatMentionToken(username: string): string {
  if (DELIMITER_SAFE_USERNAME_PATTERN.test(username)) return `@${username}`;
  const escaped = username.replaceAll("\\", "\\\\").replaceAll("}", "\\}");
  return `@{${escaped}}`;
}

export function isDelimiterSafeUsername(username: string): boolean {
  return DELIMITER_SAFE_USERNAME_PATTERN.test(username);
}

/**
 * Parse mention tokens from plain Markdown while leaving Markdown-owned regions
 * alone. The parser deliberately returns syntactic tokens; save-time roster
 * validation decides whether they resolve to a current vault member.
 */
export function parseMentionTokens(value: string): MentionToken[] {
  const fenced = collectFencedCodeRanges(value);
  const excluded = [
    ...fenced,
    ...collectInlineCodeRanges(value, fenced),
    ...collectMarkdownLinkRanges(value),
    ...collectEmailRanges(value),
  ];
  const tokens: MentionToken[] = [];
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    if (value[cursor] !== "@" || rangeContains(excluded, cursor)) continue;
    const token = parseAt(value, cursor);
    if (token) {
      tokens.push(token);
      cursor = token.end - 1;
    }
  }
  return tokens;
}

export function extractMentionUsernames(value: string): string[] {
  return parseMentionTokens(value).map((token) => token.username);
}

/** Parse a persisted projection; malformed/legacy values fail closed to []. */
export function parsePersistedMentionRecipients(value: unknown): string[] {
  const parsed = MentionRecipientsSchema.safeParse(value);
  if (!parsed.success) return [];
  return [...new Set(parsed.data)];
}

/**
 * Resolve every syntactic token against the exact-case current roster and
 * return a deduplicated projection. No username is included in the error so a
 * rejected save cannot disclose roster membership.
 */
export function buildMentionRecipients(
  value: string,
  rosterUsernames: readonly string[],
): string[] {
  const roster = new Set(rosterUsernames);
  const usernames = extractMentionUsernames(value);
  const unresolved = usernames.some((username) => !roster.has(username));
  if (unresolved) return [];
  return [...new Set(usernames)];
}
