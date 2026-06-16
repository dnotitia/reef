# `web/src/features` — Feature And State Rules

- Feature code lives under `packages/web/src/features/{domain}/components|hooks|stores`.
- Shared UI only goes in `packages/web/src/components/`; do not hide
  cross-feature components inside one feature directory.
- Client mutation helpers are camelCase `.actions.ts` modules that call Route
  Handlers through `apiFetch`.
- Zustand is UI state only and must use granular selectors.
- TanStack Query is server/data state only; use hierarchical query keys and its
  built-in loading/error state instead of global loading state.
- Dexie/IndexedDB is per-user persisted browser state only; storage-specific
  rules live in `packages/web/src/lib/storage/AGENTS.md`.
