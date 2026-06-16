# reef Architecture

This document explains how reef is put together for contributors who want to
understand the system before changing it. It describes the major boundaries, the
data model, where credentials live, and the cross-cutting rules that keep the
codebase coherent. This document covers *how* reef is built; for a product
overview, see the [root README](../README.md).

reef is an agentic, AKB-backed issue tracker. Teams work in issues, priorities,
statuses, plans, and reports; developers and coding agents leave evidence in
commits, pull requests, branches, and code changes. reef reads monitored GitHub
repositories read-only and turns that activity into reviewable signal — draft
issues for untracked work, proposed status transitions, and grounded AI answers
about the workspace. Every write stays human-reviewed.

## Overview

reef has three runtime tiers:

- **AKB** — the managed backend. A team owns an AKB *vault* that stores its
  issues, templates, planning data, and settings as documents and tables. AKB
  exposes the vault over HTTP and over MCP, so coding agents can read and update
  issues directly. reef does not run its own database.
- **`@reef/core`** — a framework-agnostic TypeScript library. It owns the Zod
  schemas, domain models, AI agents, tool definitions, error types, and every
  adapter that talks to AKB, GitHub, and the LLM provider. It has no Next.js,
  React, DOM, or browser-storage dependencies.
- **reef-web** — a Next.js App Router application that renders the product UI and
  acts as a **stateless Backend-for-Frontend (BFF)** over the AKB vault. Its
  Route Handlers validate input, extract credentials, call `core`, and translate
  errors. It persists no user-specific server state.

```
Browser (React UI, Zustand, TanStack Query, Dexie)
   │  apiFetch → /api/* Route Handlers
reef-web (stateless Next.js BFF)
   │  @reef/core adapters (the only place external I/O originates)
   ├── AKB vault   (issues, planning, templates, settings)  — read + write
   ├── GitHub      (monitored repos)                        — read-only grounding
   └── LLM provider (OpenRouter-compatible)                 — chat + agents
```

The repository is a pnpm workspace with two private, unpublished packages under
`packages/`: `core` (`@reef/core`) and `web`. The root `package.json` is the
single product version source of truth. New product behavior that touches
schemas, adapters, agents, or shared contracts starts in `core` and then
surfaces through `web`.

## The core/web boundary and thin Route Handlers

`core` and `web` exist to keep two concerns apart: framework-agnostic domain
logic, and the Next.js web/BFF surface. Mixing them would bind domain logic to
Next.js and scatter external I/O across the app.

- **`core` is the only place external I/O originates** — not just data-plane
  reads and writes to AKB, GitHub, and the LLM, but auth and session calls
  (`login`, `getMe`, `getCurrentActor`) as well. The AKB adapter is constructed
  per request and forwards an `Authorization: Bearer <pat>` header to
  `AKB_BACKEND_URL`.
- **`web` consumes `core` through thin Route Handlers** under
  `packages/web/src/app/api/*/route.ts`. A handler validates the request with a
  Zod schema, extracts credentials from the `__reef_session` cookie and request
  headers, calls `core`, and translates errors into PM-facing language and HTTP
  status. Handlers own only the session/cookie lifecycle — no business logic, no
  inline `fetch`, and no inline AKB wire schemas.
- **All user mutations flow through `apiFetch`** in client `.actions.ts` files,
  which call the Route Handlers. **Server Actions are not used**, so reads,
  mutations, and chat streaming all travel the same `apiFetch` → Route Handler →
  `core` path.

The trade-off is boilerplate: every mutation needs both a Route Handler and a
client action. In exchange, domain logic is testable without Next.js, external
I/O has a single home, and the web tier stays a thin, replaceable BFF.

## AKB as the managed backend and the issue data model

A reef issue has two natures at once. It is a **human-readable narrative**
(description, context, rationale — knowledge worth keeping) and a **queryable
record** (status, priority, assignee, labels, relations — the fields boards,
lists, and filters need to be fast). No single representation serves both well:
a pure document filters slowly, and a pure table row loses the narrative.

reef therefore models an issue as **two linked records inside the team's AKB
vault**:

- An **AKB task document** (`type=task`) holds the plain-markdown body and
  AKB-native fields. Its title is the uppercase reef id (for example `REEF-001`),
  which gives a deterministic document path. There is **no YAML frontmatter** and
  no per-issue markdown file in this repository.
- A **`reef_issues` table row** is the queryable read projection. It carries the
  reef extension fields (`status`, `priority`, `assigned_to`, `archived_at`, …)
  plus denormalized copies of title, labels, and relations, so a board becomes a
  single `SELECT` rather than a full-vault fetch with client-side filtering. The
  `document_uri` column links the row to its document.

Each field has exactly **one storage location**: AKB-native fields live on the
document; fields that must be filtered or sorted are typed `reef_issues`
columns; ad-hoc fields live in the row's `meta` JSON. `IssueMetadataSchema` is
canonical, and all issue schemas derive from it. Automated changes record their
trigger in `reef_issues.meta.source`.

Supporting state lives in sibling tables provisioned when a vault is set up:
`reef_templates` (templates addressed by name, not searchable documents),
`reef_settings`, and `monitored_repos`. The issue id prefix is the
`project_prefix` value in `reef_settings` (uppercase A–Z, default `REEF`).

**Writes are last-write-wins** and span two stores (document + row)
non-transactionally. There is no compare-and-swap, no `sha`, no
`expectedHeadOid`, and no diff/merge UI. The write path deletes a
just-created document if the row insert fails, so it leaves no orphans. A
`ConflictError` (AKB's HTTP 409) is exceptional — surfaced to the user as a
retryable "save conflict", not a routine save race. This keeps boards fast and
issue bodies reusable as knowledge; the cost is a partial-failure window and the
possibility of silently overwriting a concurrent edit, which is acceptable for
PM metadata.

## Stateless web tier and credential placement

reef-web is the only server reef operates. To keep data ownership with the team
and avoid per-user storage, **reef-web persists nothing that belongs to a
specific user**: no database, no server-side session store, no Redis, no
per-user cache, no KMS. Per-user state lives at the edges. The three credentials
the system needs are each placed deliberately:

- **AKB session** — a JWT inside the `__reef_session` httpOnly cookie. It is
  decoded read-only per request and forwarded to AKB as
  `Authorization: Bearer <pat>`. It is never mirrored to server memory or disk,
  and `httpOnly` keeps it out of browser JavaScript.
- **GitHub token** — stored only in browser IndexedDB (origin-scoped) and
  attached per request as `Authorization: Bearer <github_token>` for read-only
  monitored-repo grounding. PAT scopes stay least-privilege (`public_repo` where
  enough, `repo` for private monitored repos).
- **LLM configuration** — deployment-managed server environment:
  `OPENROUTER_API_KEY` (secret), `OPENROUTER_BASE_URL`, and `REEF_LLM_MODEL`.
  There are no per-user or bring-your-own LLM keys and no per-user LLM headers.

A redacting logger masks `Authorization`, `Cookie`, `Set-Cookie`, and the
LLM-config header in request and error logs; if a known token substring appears
in output, tests fail. The main residual risk — a PAT in the browser as an XSS
target — is mitigated by the strict CSP described below.

## The AI layer

reef runs bounded agent loops (issue enrichment, activity scan, chat) and
streams chat to the browser. The AI layer is built on the **Vercel AI SDK**:

- Chat streaming is assembled in `core` (`agents/chatAgent.ts`) using the SDK's
  agent loop and UI-stream helpers. `web` does not rebuild the loop; it delegates
  to a `core` helper. The client consumes the `UIMessage` stream with `useChat`
  and reads message *parts* (it never assumes `content` is a plain string).
- Tools are defined once with a single Zod schema that serves as the LLM
  descriptor, the runtime validator, and the TypeScript type. Tool input schemas
  stay **strict-JSON-Schema compatible**: every property is required, nullable
  fields use `z.nullable()` (not `.optional()`), and parse defaults use
  `.default(value)`. AI tool names are `snake_case`.
- **The chat tool catalog is read-only**, so there is no approval-gating surface
  to maintain, and the vault is closure-bound into the AKB tools so a
  prompt-injection attempt cannot reach another vault. Enrichment and activity
  scan are separate bounded agents whose outputs are *proposals* gated by human
  approval. If a mutating chat tool is ever added, it must set
  `needsApproval: true` and `web` must wire a client approval flow.

## Read-only GitHub grounding

reef grounds its agents in the team's monitored repositories: it needs to read
code reality, but it must never become a writer or commit under a user's
identity. The GitHub adapter in `core` is intentionally thin and scoped to
monitored repos: activity detection (commits, pull requests), code search, file
reads, and repository labels, via Octokit REST and GraphQL.

It is strictly **read-only** — no managed-repo writes, no local Git, no clones.
Consequently the GitHub credential's blast radius is read-only, core issue CRUD
does not depend on GitHub (a grounding failure degrades only grounding
features), and code reality is pulled by user-initiated scans rather than pushed
from repos.

## Browser state: Zustand, TanStack Query, Dexie

The browser holds three kinds of state with different lifetimes, and reef keeps
them strictly separated so that global loading flags and stale caches do not
emerge:

- **Zustand** — ephemeral UI state only (view mode, filters, sidebar,
  preferences), always read through granular selectors.
- **TanStack Query** — server/data state only, fetched via `apiFetch`. Query
  keys are hierarchical and loading/error state is per query; there is no global
  loading flag.
- **Dexie / IndexedDB** — per-user persistent browser state only, in two live
  stores. `config` holds the active `vault`, theme, AKB user id, and per-vault UI
  preferences (active scan repo, saved issue filters). `credentials` holds the
  GitHub PAT only. Monitored repos, `project_prefix`, and LLM settings are *not*
  in `config` — they are AKB or deployment state. The AKB session is not browser
  JavaScript state at all; it is the `__reef_session` cookie.

Changing a Dexie store layout requires a version bump plus a migration closure,
and changing a persisted query shape may require a TanStack Query buster bump.
See [docs/migration-policy.md](migration-policy.md).

## Zod schemas as the boundary contract

Data crosses several boundaries — AKB documents, `reef_issues` rows, GitHub
payloads, Route Handler I/O, and LLM tool I/O. Redefining a shape at each layer
invites drift and silently broken contracts.

The Zod schemas in `packages/core/src/schemas/` are the **single source of truth
for boundary data**. Consumers import the inferred types rather than redefining
shapes; `web` never restates a `core` shape. The schema layer is also the single
translation seam between conventions: **wire fields stay `snake_case`** (AKB
documents and rows, GitHub payloads) while **TypeScript variables, functions,
and React props stay `camelCase`**. Inputs are validated against the relevant
schema at the Route Handler boundary, and schema names use PascalCase plus the
`Schema` suffix.

## Field-display ownership: core metadata, web leaves

Issue fields appear on many surfaces — board cards, list rows, detail panes,
dialogs — carrying both semantic metadata (labels, options, sort order) and
visual style. reef splits ownership so that `core` never becomes bound to React
or Tailwind and so that no single configuration-driven mega-view emerges:

- **Field metadata lives in `core`** (`schemas/issues/fieldRegistry.ts`,
  exported as `@reef/core/fields`) as **pure TypeScript — no React, no
  Tailwind**.
- **Tailwind color classes live in `web`** (`components/fields/fieldKit.ts`).
- **Shared field "leaves"** live in `packages/web/src/components/fields/` and are
  imported by file, directly. There is deliberately **no barrel `index.ts`** and
  **no configuration-driven `<UnifiedIssueView variant>` mega-view**. Each
  surface *composes* leaves rather than merging them into one component.

This keeps field semantics framework-agnostic and reusable, styling in `web`,
and each surface independent. The cost — many small leaf files and explicit
imports — is intentional.

## Error model: ReefError and core-canonical translation

Failures arrive from the AKB, GitHub, and LLM boundaries with provider-specific
shapes and HTTP codes. Users should see consistent, actionable language, not raw
provider errors.

- **Error classes extend `ReefError`** in `packages/core/src/errors/`. `core` is
  the canonical place that classifies boundary failures (especially AKB) into
  typed reef errors carrying fields such as `resourceKind`. Subclasses include
  `SchemaValidationError`, `AkbApiError`, `GitHubApiError`, `LlmError`,
  `AuthError`, `NotFoundError`, `ConflictError`, and `ActivitySuggestionError`.
- **Route Handlers translate `ReefError`** into PM-facing language and an
  appropriate HTTP status (via a shared `translateError` helper); they do not
  invent their own ad-hoc error mappings.
- A `ConflictError` (HTTP 409) surfaces as a retryable save conflict; an
  authentication failure surfaces as a prompt to re-authenticate.

New boundary failure modes are classified into the `core` `ReefError` hierarchy
rather than mapped inline in `web`, which keeps PM-facing translation uniform.

## Observability, security headers, and deployment

reef-web is a self-hosted service that handles credentials and streams
responses, so it needs tracing, strict browser security, and a deployment that
preserves Server-Sent Events.

- **Tracing and metrics.** OpenTelemetry spans wrap every server-side async
  boundary that touches AKB, GitHub, or the LLM; browser IndexedDB access is not
  traced. Traces, metrics, and errors are exported to self-hosted collectors,
  and `/api/metrics` is a Prometheus-format scrape endpoint protected at the
  network layer.
- **Security headers.** Authenticated routes go through
  `packages/web/src/proxy.ts`, which applies a strict nonce-based Content
  Security Policy: `script-src 'self'`, no `unsafe-inline`, no third-party
  scripts, and a per-request nonce. Combined with the redacting logger, this
  contains the XSS risk of a browser-held PAT. CI audits for CSP regressions.
- **Deployment.** `next.config.ts` sets `output: "standalone"`, and the root
  `Dockerfile` builds a small `node:22-alpine` image that runs the standalone
  server as a non-root user. It deploys to Kubernetes as a sibling of the AKB
  deployment, using rolling updates; clients pick up a new version on their next
  full page load.
- **Streaming.** `/api/chat` must stay SSE-compatible. Proxy buffering must be
  disabled (`proxy_buffering off` on the nginx/Kubernetes ingress) and read
  timeouts raised for long agent loops. This is an operational requirement, not
  an option: if it is misconfigured, the chat stream breaks silently.

## Where to look in the code

| Area | Location |
| --- | --- |
| Boundary schemas | `packages/core/src/schemas/` (`issues`, `planning`, `workspace`, `activity`, `ai`, `common`) |
| Domain models | `packages/core/src/models/` (issue ids, status transitions, code-signal inference) |
| AKB adapter | `packages/core/src/adapters/akb/` (`issues`, `planning`, `workspace`, `activity`, `vaultSkill`, `core`) |
| GitHub adapter | `packages/core/src/adapters/github.ts` (read-only) |
| LLM adapter | `packages/core/src/adapters/llm.ts` |
| AI agents and tools | `packages/core/src/agents/` (`chatAgent`, `enrichIssue`, `scanActivity`, `framework`, `prompts`, `tools`) |
| Error types | `packages/core/src/errors/` |
| Route Handlers (BFF) | `packages/web/src/app/api/*/route.ts` |
| UI features | `packages/web/src/features/` |
| Field leaves and styling | `packages/web/src/components/fields/` |
| Browser state and storage | `packages/web/src/lib/` (`storage`, `api`, `github`, `llm`) |
| CSP / security headers | `packages/web/src/proxy.ts` |

## Related documentation

- [Root README](../README.md) — quick start and commands
- [UX design](ux-design.md)
- [Release policy](release-policy.md) and [migration policy](migration-policy.md)
- [Core package README](../packages/core/README.md) and
  [web package README](../packages/web/README.md)
