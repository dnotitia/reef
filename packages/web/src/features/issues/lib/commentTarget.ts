const COMMENT_TARGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export function commentTargetId(commentId: string): string | null {
  const normalized = commentId.trim();
  return COMMENT_TARGET_ID_PATTERN.test(normalized)
    ? `comment-${normalized}`
    : null;
}
