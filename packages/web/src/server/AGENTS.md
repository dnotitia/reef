# `web/src/server` — Server Boundary Rules

- Everything under this tree is server-only. Never import it from a client
  component, browser hook, or client-side utility.
- This tree owns deployment-managed GitHub and LLM I/O, credential resolution,
  agent application code, and provider-specific error normalization. Use the
  public `@reef/core` surface for AKB access, domain schemas, models, errors,
  and observability.
- Keep local credentials in request-scoped server adapters or the httpOnly AKB
  JWT boundary. SSO token sets are the sole per-user server-state exception:
  keep them encrypted in the `server/auth` session repository and expose only
  an opaque httpOnly handle. Do not log tokens, raw cookies, prompt text, or
  upstream response bodies.
- Wrap async provider boundaries in OpenTelemetry spans and use the shared web
  logger for request/server diagnostics.
