/**
 * @module prompts
 *
 * ## CHANGELOG
 *
 * Intentional behavioral changes vs. Tauri-era `crates/reef-core/src/llm/prompts.rs` (commit e554ed3):
 *
 * 1. **ProjectState issue sort**: The Tauri version sorted using `StatusEnum` variants from the
 *    domain model. The TypeScript version uses a plain string map (`STATUS_ORDER`) keyed by
 *    status string values ("in_progress", "in_review", "todo", "done", "closed"). Unknown
 *    statuses get order 99 (sorted last). Functionally equivalent for all known status values.
 *
 * 2. **ProjectState user prompt**: The Tauri version included a "Recent Progress Notes" section
 *    when `question.progress_notes` was non-empty. The TypeScript `ProjectStateUserPromptRequest`
 *    schema does not include progress notes (that data structure is Tauri-era specific).
 *    Progress notes context is omitted from this port; it can be added in Epic 14 if needed.
 *
 * 3. **Input validation**: The Tauri version accepted owned structs. The TypeScript version
 *    accepts plain objects matching the Zod schemas; no runtime `z.parse()` is called inside
 *    the prompt builders (TypeScript types are the guard).
 *
 * All other prompt content and behaviors are faithful ports of commit e554ed3.
 */

export {
  buildEnrichmentSystemPrompt,
  buildEnrichmentUserPrompt,
} from "./enrichment";
export {
  buildAutoIssueSystemPrompt,
  buildAutoIssueUserPrompt,
} from "./autoIssue";
export {
  buildStatusRationaleSystemPrompt,
  buildStatusRationaleUserPrompt,
} from "./statusRationale";
export {
  buildProjectStateSystemPrompt,
  buildProjectStateUserPrompt,
} from "./projectState";
export {
  buildWorkspaceChatSystemPrompt,
  truncateForContext,
  CHAT_ISSUE_CONTEXT_BODY_CHAR_LIMIT,
  type WorkspaceChatSystemPromptOptions,
} from "./workspaceChat";

// Re-export Zod schema types from schemas/ai/prompts
export type {
  PrDetail,
  CommitDetail,
  EnrichmentUserPromptRequest,
  AutoIssueUserPromptRequest,
  ActivityIssueLinkUserPromptRequest,
  ActivityIssueLinkDecision,
  StatusRationaleUserPromptRequest,
  ProjectStateSystemPromptOptions,
  ProjectStateUserPromptRequest,
} from "../../schemas/ai/prompts";

export {
  EnrichmentUserPromptRequestSchema,
  StatusRationaleUserPromptRequestSchema,
  ProjectStateUserPromptRequestSchema,
} from "../../schemas/ai/prompts";
