# `web/src/components/fields` — Field Leaf Rules

- Tailwind color classes for issue fields live in `fieldKit.ts`.
- Shared field leaves are imported directly by file. Do not add a barrel
  `index.ts` in this directory.
- Surfaces such as board cards, list rows, detail views, and dialogs compose the
  leaves; they are not merged.
- Do not create a configuration-driven mega view such as
  `<UnifiedIssueView variant>`.
