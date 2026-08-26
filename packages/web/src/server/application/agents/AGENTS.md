# `web/src/server/application/agents` — Agent And Tool Rules

- This tree is server-only. It owns the direct chat and enrichment pipelines,
  their shared lifecycle event emitter, prompts, use cases, and AI SDK tools.
  It may import `@reef/core` public schemas, models,
  errors, observability, and AKB adapter functions, but browser modules and
  Route Handlers must not import its implementation files directly except via
  the application barrel.
- Tool definitions use `tool({ inputSchema, ... })` with Zod I/O; reuse the same
  core schema for the LLM descriptor, runtime validation, and TypeScript types.
- Tool input schemas must be strict-JSON-Schema compatible: every property is
  required, nullable values use `z.nullable()` instead of `.optional()`, and parse
  defaults use `.default(value)`.
- The current chat tool catalog is read-only. If a mutating chat tool is added,
  set `needsApproval: true` and wire the client approval flow in `web`.
- Chat streaming assembly uses `ToolLoopAgent` /
  `createAgentUIStreamResponse` in this tree. The route builds per-request
  adapters and delegates to the application barrel; it does not rebuild the
  loop or own provider credentials.
- Keep prompts, tool descriptors, and use cases separated under `prompts/`,
  `tools/`, and their feature modules. Shared framework code is limited to the
  typed lifecycle/event seam used by both live tasks.
