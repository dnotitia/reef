import type { Comment } from "@reef/core";
import type { JiraCommentPayload } from "../payloads.js";
import type {
  JiraImportedCommentInput,
  JiraRelatedImportTarget,
} from "./contracts.js";

export const jiraCommentVisibility = (
  comment: JiraCommentPayload,
): "safe" | "restricted" | "unverified" => {
  if (comment.visibility !== undefined) return "restricted";
  if (comment.properties === undefined) return "unverified";
  const serviceManagementVisibility = comment.properties.find(
    (property) => property.key === "sd.public.comment",
  );
  if (!serviceManagementVisibility) return "safe";
  const value = serviceManagementVisibility.value;
  if (typeof value !== "object" || value === null || !("internal" in value))
    return "unverified";
  return value.internal === false ? "safe" : "restricted";
};

export const validCommentReadback = (
  readback: Comment | null,
  expected: JiraImportedCommentInput,
): boolean =>
  readback !== null &&
  readback.reef_id === expected.reefId &&
  readback.body === expected.body &&
  readback.author === expected.author &&
  readback.created_at === expected.createdAt &&
  readback.edited_at === expected.editedAt &&
  readback.parent_comment_id === (expected.parentCommentId ?? null) &&
  readback.thread_root_id === expected.expectedThreadRootId;

export const revokeCommentTargets = async (
  target: JiraRelatedImportTarget,
  commentIds: Iterable<string | null | undefined>,
): Promise<void> => {
  for (const commentId of new Set(
    [...commentIds].filter((id): id is string => id != null),
  )) {
    await target.deleteComment(commentId);
    if ((await target.readComment(commentId)) !== null)
      throw new Error("comment_revocation_readback_mismatch");
  }
};
