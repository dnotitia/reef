# `core/src/agents` — Agent And Tool Rules

- Tool definitions use `tool({ inputSchema, ... })` with Zod I/O; reuse the same
  schema for the LLM descriptor, runtime validation, and TypeScript types.
- Tool input schemas must be strict-JSON-Schema compatible: every property is
  required, nullable values use `z.nullable()` instead of `.optional()`, and parse
  defaults use `.default(value)`.
- The current chat tool catalog is read-only. If a mutating chat tool is added,
  set `needsApproval: true` and wire the client approval flow in `web`.
- Chat streaming assembly uses `ToolLoopAgent` /
  `createAgentUIStreamResponse` in `packages/core/src/agents/chatAgent.ts`; the
  `web` route should delegate to the core helper instead of rebuilding the loop.
- Agent building blocks live under `agents/{framework,prompts,tools}/`. Keep
  prompts, tool descriptors, runtime loops, and framework helpers separated.
