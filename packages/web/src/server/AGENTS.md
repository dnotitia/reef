# `web/src/server` — Server Boundary Rules

- Everything under this tree is server-only. Never import it from a client
  component, browser hook, or client-side utility.
- This tree owns deployment-managed GitHub and LLM I/O, credential resolution,
  agent application code, and provider-specific error normalization. Use the
  public `@reef/core` surface for AKB access, domain schemas, models, errors,
  and observability.
- Keep credentials in request-scoped server adapters or the httpOnly AKB
  session boundary. Do not log tokens, raw cookies, prompt text, or upstream
  response bodies.
- The ordinary server boundary is stateless and uses the AKB-issued
  `__reef_session` cookie. Auth-v2 Route Handlers are an explicit, separate
  exception: they may use the encrypted Redis session primitives in this
  directory, but only with `REEF_AUTH_V2_ENABLED=1`, the strict AKB v2 catalog,
  and the opaque `__reef_auth_v2` cookie. Never let that exception alter or
  fall back into the v1 cookie/API path.
- Wrap async provider boundaries in OpenTelemetry spans and use the shared web
  logger for request/server diagnostics.
