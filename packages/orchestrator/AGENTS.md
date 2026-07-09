# `orchestrator` - Package-Local Rules

> Cross-cutting rules live in the root `AGENTS.md`. This package owns the
> long-running orchestration runtime that must stay outside `reef-web`.

## Package Role

- `orchestrator` owns process lifecycle, run-loop scheduling, dry-run startup,
  idle polling, and graceful shutdown for background Reef orchestration.
- Domain I/O goes through contracts exported by `@reef/core`. Do not add direct
  AKB, GitHub, LLM, Next.js, React, DOM, or browser-storage dependencies here.
- `web` may expose dispatch/control-plane Route Handlers and UI, but it must not
  host worker polling or long-running orchestration loops.

## Testing And Layout

- Co-locate tests beside their targets under `src/`.
- Keep the loop body environment-agnostic: inject timers, signals, ports, and
  logging so local mode, server workers, and tests exercise the same code.
- CLI output may use JSON lines through stdout/stderr, but never print secrets
  such as tokens, private keys, cookies, LLM prompts, or raw upstream bodies.
