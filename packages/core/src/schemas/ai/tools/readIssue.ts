import { z } from "zod";
import { IssueMetadataSchema } from "../../issues/metadata";

/**
 * `{PREFIX}-{NUMBER}` — uppercase ASCII prefix + dash + positive integer.
 * Mirrors the Route Handler guard (`ISSUE_ID_PATH_REGEX`) and the
 * {@link parseIssueId} contract. Schema-level enforcement is the security
 * boundary for AI-supplied ids: closure-bound vault + this regex together
 * prevent path-traversal escapes like `../other-vault/...` from concatenating
 * into the akb URL `/documents/${vault}/${id}`.
 */
const ISSUE_ID_REGEX = /^[A-Z]+-\d+$/;

export const ReadIssueInputSchema = z.object({
  /** Reef issue id (e.g. "REEF-001"). Vault is bound at factory construction. */
  id: z
    .string()
    .regex(ISSUE_ID_REGEX, "id must match PREFIX-NUMBER (e.g. REEF-001)"),
});

const ReadIssueToolIssueSchema = IssueMetadataSchema.pick({
  id: true,
  title: true,
  status: true,
  issue_type: true,
  priority: true,
  assigned_to: true,
  requester: true,
  reporter: true,
  start_date: true,
  due_date: true,
  milestone_id: true,
  sprint_id: true,
  release_id: true,
  estimate_points: true,
  severity: true,
  parent_id: true,
  labels: true,
  depends_on: true,
  blocks: true,
  related_to: true,
});

export const ReadIssueOutputSchema = z
  .object({
    issue: ReadIssueToolIssueSchema,
    content: z.string(),
  })
  .strict();

export type ReadIssueOutput = z.infer<typeof ReadIssueOutputSchema>;
