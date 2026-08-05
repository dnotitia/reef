# `orchestrator` - Package-Local Rules

> Cross-cutting rules live in the root `AGENTS.md`. This package owns the
> long-running orchestration runtime that must stay outside `reef-web`.

## Package Role

- `orchestrator` owns provider registry preflight, one-run lifecycle events,
  cancellation, cleanup, terminal normalization, and the process signal seam.
- The shared `executeRunPlan` entrypoint receives the immutable `RunPlan`, a
  typed provider registry, and one caller-owned execution callback. Callers own
  queue selection, scheduling, persistence, delivery ordering, and concrete
  adapters.
- This package has no Reef configuration loader, CLI, environment aliases,
  idle polling loop, or Reef-owned domain ports.
- Do not add direct AKB, GitHub, LLM, Next.js, React, or browser-storage
  dependencies here. Provider contracts come from this package's
  provider-neutral types.
- `web` may expose dispatch/control-plane Route Handlers and UI, but it must not
  host worker polling or long-running orchestration loops.

## Testing And Layout

- Co-locate tests beside their targets under `src/`.
- Keep execution environment-agnostic: inject the clock, abort signal, event
  sink, provider registry, and callback so foreground callers, scheduler
  adapters, and tests exercise the same engine contract.
- Keep terminal results and structured lifecycle events secret-free. Never
  expose tokens, private keys, cookies, LLM prompts, raw upstream bodies, raw
  thrown objects, or mutable runtime handles.
