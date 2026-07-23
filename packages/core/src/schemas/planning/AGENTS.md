# `core/src/schemas/planning` — Planning Schema Rules

- Planning schemas and enums in `catalog.ts` are canonical for releases,
  milestones, sprints, their statuses, and planning catalog boundary data.
- Planning display metadata lives in `fieldRegistry.ts` and is exported via
  `@reef/core/fields/planning`; keep it pure TypeScript with no React, Tailwind,
  or locale resolution.
- Derive option arrays from the schema enums. Keep the English base catalog
  exhaustive so adding an enum member without a label fails type checking.
- Web owns locale resolution and Tailwind colors in
  `packages/web/src/components/fields/planningFieldKit.ts`; audit both sides when
  a planning kind or status changes.
