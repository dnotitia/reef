import type { Comment } from "../schemas/issues/comment";

/**
 * Keep roots and replies whose parent chain resolves to the declared top-level
 * root. Broken, cross-issue, cyclic, and incomplete chains are excluded.
 */
export function filterValidCommentThreadMembers(
  comments: readonly Comment[],
): Comment[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const validity = new Map<string, boolean>();
  const visiting = new Set<string>();

  const isValid = (comment: Comment): boolean => {
    const cached = validity.get(comment.id);
    if (cached !== undefined) return cached;
    if (visiting.has(comment.id)) return false;

    visiting.add(comment.id);
    const parentId = comment.parent_comment_id ?? null;
    const rootId = comment.thread_root_id ?? null;
    let valid = parentId === null && rootId === null;
    if (parentId !== null && rootId !== null) {
      const parent = byId.get(parentId);
      const root = byId.get(rootId);
      valid =
        !!parent &&
        !!root &&
        parent.id !== comment.id &&
        parent.reef_id === comment.reef_id &&
        root.reef_id === comment.reef_id &&
        (root.parent_comment_id ?? null) === null &&
        (root.thread_root_id ?? null) === null &&
        ((parent.parent_comment_id ?? null) === null
          ? parent.id === root.id
          : parent.thread_root_id === root.id && isValid(parent));
    }
    visiting.delete(comment.id);
    validity.set(comment.id, valid);
    return valid;
  };

  return comments.filter(isValid);
}
