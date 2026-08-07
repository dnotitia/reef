# `validation-provider-local` package rules

This package owns the private local adapter for trusted validation commands.

- Depend only on `@reef/orchestrator`; do not import Reef, AKB, GitHub, Codex,
  web, persistence, or the infrastructure provider.
- Bind one exact repository real path and run only the frozen ordered checks
  from the provider-neutral validation request. Never infer commands, cwd,
  shell, or environment from an untrusted request.
- Pass only the explicitly configured environment, keep output bounded and
  redacted, and keep repository paths, raw logs, process handles, and mutable
  state inside the factory closure.
- Validate the repository identity, exact candidate HEAD, and tracked/untracked
  cleanliness before starting a validation command. Timeout and cancellation
  must terminate the complete child process group within the bounded grace
  period.
- This adapter returns reviewer-facing proof only. It does not retry, persist
  proof, write issue metadata, schedule work, or expose a CLI.
