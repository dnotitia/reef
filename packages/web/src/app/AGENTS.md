# `web/src/app` — App Router Rules

- Route Handlers (`app/api/*/route.ts`) are thin wrappers: validate with Zod,
  extract credentials from request headers or the `__reef_session` cookie, call
  `core`, translate errors to PM-facing language, and return the response.
- No business logic in Route Handlers. All user-initiated mutations go through
  Route Handlers via `apiFetch`; Next.js Server Actions are not used.
- Credentials stay in request headers or the httpOnly cookie, never URL query
  strings.
- The Ask AI chat runs on `POST /api/agents/runs` with `task_id:
  "chat.workspace"` (REEF-361). The route builds per-request akb/GitHub/LLM
  adapters and delegates streaming to `createWorkspaceChatAgentResponse` from
  `@reef/core`, wrapping its UI-message stream in the agent-run SSE bridge
  (`createChatRunEventBridge`) so text deltas, tool-call frames, and run
  lifecycle events reach the client. The client consumes it through
  `useWorkspaceChat` / `useAgentRun`.
- `/api/chat` is the legacy AI-SDK `useChat` endpoint, now `@deprecated` and
  unused by the client (kept pending removal). Do not add new callers; new chat
  work targets the agent-run route.
- Chat tools are read-only. If a mutating tool is added later, pair its
  `needsApproval: true` contract with the client approval-response flow.
- Keep the chat run route streaming-compatible; proxy buffering must remain
  disabled in deployment (`X-Accel-Buffering: no` on the SSE response).
