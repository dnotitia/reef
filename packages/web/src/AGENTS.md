# `web/src` — Source-Wide Rules

## Proxy, Logging, And CSP

- Authenticated routes use strict nonce-based CSP through `proxy.ts`.
- Per-request logging for `/api/*` happens once at `proxy.ts`; Route Handlers do
  not re-log inbound requests.
- Log via the shared `logger` from `@/lib/logging/logger`; its pino config
  redacts credential headers (`Authorization`, `X-Reef-LLM`, `Cookie`,
  `Set-Cookie`, `Proxy-Authorization`) and serializes errors to a safe shape, so
  calling it directly is safe.

## Browser Runtime Verification

- For UX or layout changes, run a browser runtime verification pass against the
  hermetic runtime when the change is visible in routed pages, dialogs,
  popovers, lists, boards, or other composed surfaces. Use
  `pnpm --filter @reef/web run dev:e2e` and reset fixture scenarios with
  `pnpm --filter @reef/web run reset:e2e -- <scenario>`.
- Open `http://localhost:7353` in a real web browser using the agent's available
  browser automation, such as Codex Browser/in-app Browser, browser-use,
  Playwright, or a manual browser. This is a runtime check, not a jsdom or
  static-code inspection.
- When an agent starts `pnpm --filter @reef/web run dev:e2e` for browser runtime
  verification, keep that terminal/session attached and inspect its stdout/stderr
  while exercising the UI. Treat `[dev:e2e]` fixture messages, Next.js compile or
  runtime errors, fixture-server failures, and pino `request`/`response` lines
  for `/api/*` as part of the debugging signal.
- If the server was started in a user-owned terminal that the agent cannot read,
  do not claim to have inspected stdout; verify the URL/browser behavior directly
  and ask for the relevant log excerpt only when the browser or HTTP symptoms
  need it.
- Keep browser runtime checks aligned with the current product scope: ordinary
  desktop window sizes are required; a narrow desktop viewport is useful for
  overflow-prone UI, but mobile support is not a default gate unless the task
  explicitly changes that contract.
- During browser runtime verification, sign in through the real login UI against
  the fixture AKB backend (`alice` / `password`) and select `reef-e2e`. Inspect
  affected workflows for visual overlap, clipping, unreadable text, broken
  dialog/popover placement, console errors, and failed `/api/*` requests.

## Source Layout

- App Router files live under `app/`; feature code lives under `features/`;
  shared UI lives under `components/`; reusable browser/server helpers live under
  `lib/`; app-level providers live under `providers/`.
- Components are PascalCase; hooks are camelCase with `use`; Route Handler files
  are always `route.ts`.
