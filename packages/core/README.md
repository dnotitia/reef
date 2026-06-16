# @reef/core

Framework-agnostic TypeScript package for reef's domain layer. `core` owns the
schemas, models, adapters, AI agents, tool definitions, and error types used by
the web application. It is consumed in-workspace as `@reef/core` and is private;
it is not published independently.

`web` should call backend services only through this package. GitHub, AKB, and
LLM calls originate here.

## Responsibilities

- Define the Zod schemas for data that crosses package and API boundaries.
- Model issue IDs, status transitions, activity suggestions, and update
  metadata.
- Read and write reef workspace data through the AKB adapter.
- Read monitored GitHub repositories for grounding only.
- Build the chat, issue-enrichment, and activity-scan agents.
- Expose typed errors that Route Handlers can translate into user-facing
  responses.

## Layout

| Path | Purpose |
| --- | --- |
| `src/schemas/` | Boundary schemas for issues, planning, workspace config, activity suggestions, and AI requests/results. `IssueMetadataSchema` is canonical for issue metadata. |
| `src/models/` | Pure domain logic: issue IDs, status transitions, code-signal inference, issue-update metadata, and activity suggestion fingerprints. |
| `src/adapters/akb/` | Managed-workspace reads and writes for issues, templates, planning, config, activity inbox, provenance, vault provisioning, and Reef vault skill installation. |
| `src/adapters/github.ts` | Read-only monitored-repo grounding: commits, pull requests, code search, file reads, and repository labels. |
| `src/adapters/llm.ts` | Deployment-managed LLM adapter. |
| `src/agents/` | Chat, enrichment, activity scan, shared prompts, agent runtime, and AI-SDK tools. |
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
- GitHub access is read-only monitored-repo grounding. Do not clone, commit,
  create issues, or open pull requests.
- Async AKB, GitHub, and LLM boundaries should be wrapped in OpenTelemetry spans.

## AI agents and tools

Tool definitions live under `src/agents/tools/` and use Zod for both runtime
validation and AI-SDK descriptors. Tool input schemas should stay strict JSON
Schema compatible: required properties are explicit, nullable fields use
`z.nullable()`, and parse defaults use `.default(value)`.

The current chat tool catalog is read-only. If a mutating chat tool is added,
the tool contract must expose approval requirements and `web` must wire the
client approval flow.

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
