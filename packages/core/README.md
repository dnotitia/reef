# @reef/core

Framework-agnostic TypeScript package for reef's domain layer. `core` owns the
schemas, models, AKB adapter, observability seam, and error types used by the
web and operator packages. It is consumed in-workspace as `@reef/core` and is
private; it is not published independently.

`web` uses this package for AKB and domain behavior. Its server-only tree owns
GitHub, LLM, and agent application code.

## Responsibilities

- Define the Zod schemas for data that crosses package and API boundaries.
- Model issue IDs, status transitions, activity suggestions, and update
  metadata.
- Read and write reef workspace data through the AKB adapter.
- Publish provider-neutral AI request, event, artifact, prompt, and tool schemas.
- Expose typed errors that Route Handlers can translate into user-facing
  responses.

## Layout

| Path | Purpose |
| --- | --- |
| `src/schemas/` | Boundary schemas for issues, planning, workspace config, activity suggestions, and AI requests/results. `IssueMetadataSchema` is canonical for issue metadata. |
| `src/models/` | Pure domain logic: issue IDs, status transitions, code-signal inference, issue-update metadata, and activity suggestion fingerprints. |
| `src/adapters/akb/` | Managed-workspace reads and writes for issues, templates, planning, config, activity inbox, provenance, vault provisioning, and Reef vault skill installation. |
| `src/schemas/ai/` | Provider-neutral agent-run, artifact, prompt, enrichment, grounding, and tool schemas. |
| `src/errors/` | `ReefError` subclasses and error translation helpers. |
| `src/utils/` | Small parsing and error-detail helpers. |
| `src/index.ts` | Public workspace export surface. |

## Storage model

A reef issue is two linked AKB records:

- an AKB task document for the plain-markdown body and AKB-native fields
- a `reef_issues` row for queryable fields such as status, priority, assignee,
  labels, planning references, archive state, and metadata

The `document_uri` links the two records. Keep document and row writes paired.
Use typed row columns for fields that must be filtered or sorted, row `meta` for
ad-hoc extension data, and the AKB document for body text. Issue templates are
table rows in `reef_templates`, not searchable AKB documents.

## Boundary rules

- No Next.js imports, React imports, DOM APIs, or browser storage access.
- Keep request/response and persisted shapes in Zod schemas; import inferred
  types instead of redefining them in `web`.
- Wire fields from AKB rows/documents and GitHub payloads stay `snake_case`.
  TypeScript variables and function names stay camelCase.
- AKB writes are last-write-wins and non-transactional across document plus row.
  Do not add CAS, `sha`, or `expectedHeadOid` plumbing in this repository.
- Async AKB boundaries should be wrapped in OpenTelemetry spans. Web-owned
  GitHub and LLM boundaries use the same core observability seam from their
  server-only adapters.

## AI boundary schemas

Provider-neutral request, event, artifact, prompt, enrichment, grounding, and
tool schemas live under `src/schemas/ai/`. Server-owned agent tools reuse these
schemas for runtime validation and AI SDK descriptors.

The current chat tool catalog is read-only. If a mutating chat tool is added,
the server application must expose approval requirements and `web` must wire
the client approval flow.

## Commands

Run package checks from the repository root:

```bash
pnpm --filter @reef/core run typecheck
pnpm --filter @reef/core run test
```

Workspace-wide gates:

```bash
pnpm biome check .
pnpm -r run typecheck
pnpm -r run test
```

## Related docs

- [Root README](../../README.md)
- [Root agent contract](../../AGENTS.md)
- [Core package rules](AGENTS.md)
- [Architecture](../../docs/architecture.md)
- [Migration policy](../../docs/migration-policy.md)
