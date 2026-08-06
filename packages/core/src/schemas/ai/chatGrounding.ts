import { z } from "zod";
import { IssueMetadataSchema } from "../issues/metadata";

/**
 * Grounding context shapes for the workspace chat agent (REEF-360).
 *
 * These describe the *credential-safe* project state that reef assembles into
 * the chat system prompt: a compact workspace summary plus, when the user is
 * looking at an issue, that issue's context. They deliberately carry PM-facing
 * PM-facing values — no session tokens, no internal user uuids, no server
 * internals — so the assembled prompt honors the observability/security
 * contract (AGENTS.md "Security And Persistence" / AC1 + AC5).
 */

const WorkspaceStatusCountSchema = z.object({
  status: z.string(),
  count: z.number().int().nonnegative(),
});

/**
 * Compact workspace summary: the vault name, the active sprint (name + goal),
 * and open-issue counts. This is the "workspace 요약" of AC1 — a summary, not
 * the full 200-issue dump the dormant projectState user prompt produces.
 */
export const WorkspaceSummarySchema = z.object({
  vault: z.string(),
  activeSprint: z
    .object({
      name: z.string(),
      goal: z.string().nullable(),
    })
    .nullable(),
  /** Total issues in a non-final status (everything except done/closed). */
  openIssueCount: z.number().int().nonnegative(),
  /** Full board breakdown, final statuses included, for context. */
  statusCounts: z.array(WorkspaceStatusCountSchema),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

/**
 * The PM-facing subset of a reef issue surfaced into chat context — the same
 * field set the `read_issue` tool already exposes to the model, so the prefetch
 * path keeps the LLM's issue view at that existing boundary.
 */
export const ChatIssueContextIssueSchema = IssueMetadataSchema.pick({
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

/**
 * The prefetched current-issue context: the safe field subset above plus the
 * plain-markdown body. The body is carried in full here; the prompt builder is
 * responsible for truncating it to the token cap (so truncation is unit-tested
 * in one pure place — AC2).
 */
export const ChatIssueContextSchema = z.object({
  issue: ChatIssueContextIssueSchema,
  body: z.string(),
});
export type ChatIssueContext = z.infer<typeof ChatIssueContextSchema>;
