# `web/src/features` — Feature And State Rules

- Feature code lives under `packages/web/src/features/{domain}/components|hooks|stores`.
- Shared UI only goes in `packages/web/src/components/`; do not hide
  cross-feature components inside one feature directory.
- Client mutation helpers are camelCase `.actions.ts` modules that call Route
  Handlers through `apiFetch`.
- Zustand is UI state only and must use granular selectors.
- TanStack Query is server/data state only; use hierarchical query keys and its
  built-in loading/error state instead of global loading state.
- One narrow exception (REEF-098): the issue feature keeps a normalized,
  read-through entity store (`features/issues/stores/issueEntityStore.ts`, built
  on `@tanstack/react-store`) as the granular render source for issue rows. It
  is *derived* from the Query cache by a single normalizer, never a second
  source of truth, and exists only so editing one issue re-renders one cell
  instead of the whole list. Do not add other client entity stores without the
  same justification; Query remains the data-state owner for everything else.
- Dexie/IndexedDB is per-user persisted browser state only; storage-specific
  rules live in `packages/web/src/lib/storage/AGENTS.md`.
