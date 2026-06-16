// LLMConfigSchema moved to @reef/core — re-exported here for older import support.
// All importers of LLMConfigSchema and LLMConfig in apps/web continue to work unchanged.
export {
  LLMConfigSchema,
  WorkspaceChatRequestBodySchema as ChatRequestBodySchema,
  type LLMConfig,
} from "@reef/core";

/**
 * ChatRequestBodySchema — validates the POST body of `/api/chat`.
 *
 * Shape: AI SDK `UIMessage[]`. Each message has `role` + `parts: Part[]`;
 * compat no-id messages are normalized to deterministic ids before
 * delegation.
 * Tool calls/results live inside `parts` (type starts with "tool-"), so the
 * pre-parts `role: "tool"` shape is no longer accepted at the top level.
 *
 * REEF-044: the validation source lives in `@reef/core`; `/api/chat` keeps
 * compat normalization while `/api/agents/runs` enforces the stricter
 * agent-run UIMessage contract.
 */
