# `web/src/app` — App Router Rules

- Route Handlers (`app/api/*/route.ts`) are thin wrappers: validate with Zod,
  extract the `__reef_session` cookie, resolve request-scoped server adapters or
  application use cases, call `@reef/core` for AKB/domain behavior, translate
  errors to PM-facing language, and return the response.
- No business logic in Route Handlers. All user-initiated mutations go through
  Route Handlers via `apiFetch`; Next.js Server Actions are not used.
- Local AKB JWTs stay in the httpOnly cookie. SSO access, refresh, and ID tokens
  stay encrypted under `server/auth`; Route Handlers resolve only the opaque
  cookie handle and current server-held access token. Token material never
  enters URL query strings, response bodies, browser storage, or cookies.
- The Ask AI chat runs on `POST /api/agents/runs` with `task_id:
  "chat.workspace"`. The route builds per-request AKB/GitHub/LLM adapters and
  delegates streaming to `createWorkspaceChatAgentResponse` from the server
  application, wrapping its UI-message stream in the agent-run SSE bridge
  (`createChatRunEventBridge`) so text deltas, tool-call frames, and run
  lifecycle events reach the client. The client consumes it through
  `useWorkspaceChat` / `useAgentRun`.
- There is no legacy chat compat endpoint. New chat work targets the agent-run
  route above.
- Chat tools are read-only. If a mutating tool is added later, pair its
  `needsApproval: true` contract with the client approval-response flow.
- Keep the chat run route streaming-compatible; proxy buffering must remain
  disabled in deployment (`X-Accel-Buffering: no` on the SSE response).
