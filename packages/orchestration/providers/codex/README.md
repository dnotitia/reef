# @reef/harness-provider-codex

Private Codex App Server harness adapter for `@reef/orchestrator`.

The package starts a configured Codex executable with the fixed argument vector
`app-server --listen stdio://`, performs the JSONL handshake, and maps thread
and turn lifecycle into the provider-neutral harness contract. It owns no Reef,
AKB, controller, or durable run state. Callers supply the repository working
directory, execution policy, and explicit child environment allowlist.

The adapter is not a CLI and is not connected to a foreground command yet. Use
the package-local `live-smoke` script only after building when a real local
Codex login is available; it creates and removes its own scratch repository.
