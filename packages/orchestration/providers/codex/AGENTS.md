# `harness-provider-codex` - Package-Local Rules

> Cross-cutting rules live in the repository-root `AGENTS.md`. The provider is
> a private, process-owning adapter and must remain outside the provider-neutral
> orchestrator package.

## Package Role

- This package owns Codex App Server local stdio JSONL transport, lifecycle,
  protocol validation, and secret-free harness event normalization.
- It may depend on `@reef/orchestrator` for provider-neutral types and
  `ProviderError`; it must not import `@reef/core`, Reef/AKB adapters, web,
  GitHub, or any persistence layer.
- Start Codex with a configured executable and fixed argv. Never interpolate
  caller input into a shell command or expose raw process/protocol data.
- Session state is in memory only. A returned session reference contains only
  the opaque thread id and provider revision; process handles, streams, prompts,
  callbacks, and pending payloads stay private to the provider instance.

## Testing

- Keep deterministic fake-executable contract tests beside the source under
  `src/`.
- Cover protocol order, policy/path validation, redaction, request matching,
  cancellation, bounded events, multi-session isolation, and cleanup.
- `scripts/live-smoke.mjs` is a private developer proof runner, not a public
  CLI. It must use a scratch Git repository and never write proof artifacts to
  the repository.
