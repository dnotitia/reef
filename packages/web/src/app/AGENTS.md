# `web/src/app` — App Router Rules

- Route Handlers (`app/api/*/route.ts`) are thin wrappers: validate with Zod,
  extract credentials from request headers or the `__reef_session` cookie, call
  `core`, translate errors to PM-facing language, and return the response.
- No business logic in Route Handlers. All user-initiated mutations go through
  Route Handlers via `apiFetch`; Next.js Server Actions are not used.
- Credentials stay in request headers or the httpOnly cookie, never URL query
  strings.
- `/api/chat` validates AI SDK `UIMessage[]`, builds per-request akb/GitHub/LLM
  adapters, and delegates streaming to `createWorkspaceChatAgentResponse` from
  `@reef/core`.
- Client `useChat` consumes `UIMessage` parts; do not assume a `content` string.
- Chat tools are currently read-only. If a mutating tool is added later, pair its
  `needsApproval: true` contract with the client approval-response flow.
- Keep `/api/chat` streaming-compatible; proxy buffering must remain disabled in
  deployment.
