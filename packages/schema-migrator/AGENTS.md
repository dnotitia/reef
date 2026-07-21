# `schema-migrator` — Package-Local Rules

- This package owns the short-lived startup migration process. It must not be
  imported by `reef-web` or run from a user-request/hot-reload path.
- All AKB I/O goes through public `@reef/core` adapter functions.
- CLI output is a credential-safe operational contract: bounded codes and
  counts only, never raw causes, environment dumps, headers, or response bodies.
- The production entrypoint is the bundled `dist/cli.mjs`; `tsx` is development
  tooling only.
