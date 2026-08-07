# `web/src/server/adapters` — Provider Adapter Rules

- `githubAdapter.ts` and `github/` own read-only monitored-repository GitHub
  transport; `githubCredentials/` owns deployment-managed App/PAT resolution.
- `llmAdapter.ts` and `llmConfig/` own the provider-neutral OpenAI-compatible
  server endpoint and deployment configuration. They must not read browser
  credentials or infer a provider from the URL.
- Provider adapters may depend on `@reef/core` schemas, error classes,
  observability, and pure utilities. They must not be exported from core or
  imported by client code.
- Keep all provider credentials and raw upstream payloads out of logs, spans,
  prompts, and API responses.
