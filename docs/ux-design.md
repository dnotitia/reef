# UX Design Specification — reef

reef is a stateless web application for AI-assisted project management. This
document describes the user experience as it is implemented in `packages/web/` today:
the surfaces a user touches, the interaction patterns they follow, the visual
system that renders them, and the design principles those choices serve. It is
living documentation — every claim here is meant to be true of the current UI,
and it is corrected when the UI changes.

It complements, rather than restates, the implementation rules in the repo and
package `AGENTS.md` files. Where they overlap (state separation,
field-display ownership, PM vocabulary), `AGENTS.md` is the binding engineering
contract and this document explains the user-facing consequence.

## Platform & Architecture Context

reef is a Next.js (App Router) application rendered with React 19. It runs
in the browser; there is no desktop build, no native packaging, and no offline
mode. The shell and shared empty-state surfaces also keep a narrow 390px
viewport usable without clipping or overlap. The product is a stateless BFF in
front of the AKB backend: the server persists no per-user session table, so the
experience follows a strict state-owner split:

- **Zustand** holds UI state only — sidebar collapse, the active issue view,
  filters, the open/closed state of the New Issue and Ask AI dialogs, user
  preferences. Components read it through granular selectors.
- **TanStack Query** holds server state — issues, planning catalog, Notification
  Inbox, linked documents, refs, activity timelines, and workspace config —
  fetched through Route Handlers via `apiFetch`. All loading and error
  affordances derive from its per-query `isPending` / `isError`; there is no
  global loading flag.
- **Dexie (IndexedDB)** holds per-user persisted browser state with no akb home
  — the *last viewed workspace* default (since REEF-315 the active workspace is
  the `/workspace/[vault]` URL segment, source of truth; Dexie is only the
  per-browser fallback the root redirector uses to choose a workspace), theme
  preference, UI locale (mirrored to a
  non-httpOnly `NEXT_LOCALE` cookie so SSR can resolve it on the first request),
  per-vault issue filters, and the previously signed-in akb user id used for
  account reconciliation. It also holds the signed-in account's workspace
  favorites as a versioned `config` envelope; favorite names are a browser-local
  exploration preference, not workspace identity or shared project state.
- **akb-backed workspace config** holds team-shared project state — the project
  prefix, monitored repositories, issue templates, and default authoring
  language. It is read and mutated through Route Handlers, not stored as a
  browser-local source of truth.

The data the UI sits on is not files. A reef issue is an akb document plus a
`reef_issues` row; there is no markdown-with-frontmatter, no Git working copy,
and no commit-on-save. Saves are last-write-wins. This shapes the interaction
model directly: editing is inline and immediate, there is no save/conflict
ceremony, and the rare save conflict is surfaced in plain project-management
language, never in Git terms.

## Project Vision & Target Users

reef's premise is that project-management metadata should be a by-product of
real work, not a separate clerical task. An AI agent reads the actual codebase
and the existing issue set when requested, then proposes structured issue edits
that a human reviews. The human stays the author and the decider; the machine
handles the tedium of structure.

reef serves two personas on one data source:

**지은 — the project manager (primary, non-developer).** Lives in a board and
a list, writes issues in natural language, and expects the tool to feel like a
project-management product, not a developer console. Never wants to fill a
ten-field form, and needs to trust automated changes — which means always
being able to see *why* something changed.

**민수 — the developer (secondary).** Works in the codebase. reef reads
monitored repositories read-only when an on-demand AI request needs grounding,
so the developer can ask about implementation without exposing credentials.

The design challenge is to give these two audiences a coherent shared surface:
the PM gets a visual, conversational, transparent experience; the developer's
work is available through explicit read-only grounding rather than background
automation.

## The Defining Experience

The experience reef is built around is **AI issue enrichment with visible
evidence**.

A PM opens the New Issue dialog, types a title and as much or as little
description as they want, and clicks **Enrich with AI**. The agent reads the
workspace's existing issues (and, when a monitored repo is configured, searches
and reads code read-only) and returns per-field suggestions — type, priority,
assignee, dates, severity, planning links, relationships, even a rewritten
title or body. Each suggestion is reviewed *inline, in place*: the field's
normal control is temporarily replaced by a small review card showing the
current value struck through, the suggested value, a confidence reading, and
the agent's one-line reasoning. The PM applies or dismisses each one, or
applies them all at once. Nothing is committed to the issue until the human
acts.

Before enrichment, reef also gives a quiet duplicate hint while the title is
being written: after a short debounce, the title line shows whether reef is
checking, found compact status/id/title rows for semantically similar existing
issues, found no close matches, or could not check. The checking state includes
a compact brand-teal `SearchProgressBar` hairline, not a bespoke spinner or the
AI purple treatment. Short CJK titles become eligible at two visible characters
so Korean issue names such as "이슈" are not silently ignored. The hint is
advisory, opens matches in a new tab for
inspection, can be dismissed as a contextual group for the current writing
session, and never blocks creating or approving an issue.

The **Ask AI** panel lets the PM interrogate the codebase conversationally with
the same read-only grounding agent. Issue-enrichment field suggestions remain
on-demand and client-ephemeral until the PM applies them.

Across these surfaces, the design rule is identical and load-bearing: **show the
why, not just the what.** A suggestion carries its reasoning and confidence; an
issue detail panel keeps the connected context visible through
linked documents, implementation refs, and the activity timeline. AI is
positioned as a transparent collaborator, never a black box.

### Experience Principles

1. **Creation is human, assistance is explicit.** People author and decide; the
   agent proposes structure only when asked. Human effort goes to judgment.
2. **Show the why, not just the what.** Every AI proposal carries its
   reasoning, confidence, or evidence. Unexplained change
   erodes trust.
3. **Human-in-the-loop by default.** No AI proposal mutates user-visible state
   without an explicit Apply / Approve. The chat agent is read-only grounding
   and holds no mutating tools.
4. **PM vocabulary, not Git vocabulary.** Every surface the PM touches speaks
   project-management language. Errors are translated ("a save conflict
   occurred"), never surfaced as Git internals.
5. **Graceful AI degradation.** When the deployment has no AI configured, the
   AI affordances simply disappear (the Ask AI button hides, enrichment is
   unavailable) and the rest of the product — browsing, creating, editing —
   keeps working.

## Desired Emotional Response

The PM should feel **visibility without interference**: the board reflects
reality, so there is no need to chase developers for status. The developer
should feel **reporting without effort**: their work surfaces without ticket
maintenance. The shared emotional core is mutual transparency achieved through
observation and review rather than nagging.

The two emotions the design actively works against are **sync anxiety** ("is
this status actually right?") and **UI overwhelm** ("what do I do on this
screen?"). The countermeasures are concrete and present in the UI: every
automated change is reviewable with its evidence before it lands; default
views are quiet and minimal; advanced controls are progressively disclosed;
and AI work is always visually distinct (purple) and always explained.

## UX Pattern Analysis & Inspiration

reef's visual and interaction language is a **dense, keyboard-first issue UI**:
a precise, dark-capable interface that treats project management as expert work.
The board and list are deliberately familiar — the innovation is reserved for
the AI surfaces, where transparency of agent activity (in the spirit of
agent-activity visualizations that make AI work watchable) is the
differentiator.

**Patterns adopted:**

- Status-column Kanban and a compact sortable list as peer views of one data
  set (also a Timeline view) — familiarity is the advantage.
- Inline, low-ceremony editing in the detail panel (inline auto-save) —
  no Save button, no dirty state.
- Agent transparency for every AI proposal — reasoning, confidence, and
  evidence shown with the suggestion.

**Anti-patterns avoided:**

- **Field overload on creation.** Title is the only hard requirement; the
  agent and progressive disclosure handle the rest.
- **Black-box automation.** No status moves and no issue is created from
  detection without a reviewable proposal and its rationale.
- **Git leaking into the PM surface.** No commit/merge/branch vocabulary
  reaches the PM.

## Design System Foundation

The component layer is **shadcn/ui** — Radix UI primitives copied into the
repo under `packages/web/src/components/ui/` and styled with **Tailwind CSS v4**. The
copy-paste model is chosen so every component is owned and fully restylable
with no library version lock-in, and so accessibility (keyboard navigation,
focus management, ARIA) comes from Radix for free. Conversational AI surfaces
use **AI Elements** (shadcn-compatible AI SDK components under
`packages/web/src/components/ai-elements/`: `conversation`, `message`, `prompt-input`),
adopted incrementally via `npx shadcn@latest add @ai-elements/...`. Components
are catalogued in **Storybook 8**, with stories co-located beside the
components they document.

The shadcn primitives in use include Button, Dialog, Sheet (the issue
slide-over), Dropdown Menu, Select, Popover, Command (the global search
palette), Table, Tooltip, Hover Card, Badge, Skeleton, Spinner, and
Sonner (toasts). Feature-specific composites live in their feature folders, and
shared but custom leaves live alongside the primitives.

Concrete UX and design-system policy for reef-web lives in this document. Short
standalone design-system notes should be folded back here rather than added as
root-level siblings, so README, architecture, and package docs keep pointing at
one source of truth.

### Customization Strategy

Design tokens are CSS custom properties defined in
`packages/web/src/app/styles/tokens.css`, composed by
`packages/web/src/app/globals.css`, in three tiers: raw HSL values per mode, semantic tokens (status, planning,
priority, type, brand, AI), and a Tailwind `@theme inline` mapping that exposes
them as role utilities (`bg-brand-fill`, `text-brand-text`,
`text-status-done-glyph`, `text-planning-open`, `bg-ai`, …). This is the
mechanism behind the field-display ownership rule: a field's *label and
options* live in core (`packages/core/src/schemas/issues/fieldRegistry.ts`, no React or
Tailwind), and a field's *color* lives in web
(`packages/web/src/components/fields/fieldKit.ts`), which maps each enum value to a
Tailwind token backed by a CSS variable. Adding or recoloring a field is a
data edit in those two files, not a component change.

## Visual Design Foundation

### Color System

reef's brand color is **teal**; **purple is reserved exclusively for AI**.
This split is the single most important color decision in the product — it
lets a user tell at a glance whether they are looking at reef chrome or at
something the agent produced. Status, priority, and issue-type each get their
own semantic palette, used only as small indicators (dots, glyphs, text), never
as large fills.

Brand and AI tokens (light mode; dark-mode variants are defined alongside):

| Token | Role | Light value |
|-------|------|-------------|
| `--brand-text` / `--brand-glyph` | readable teal text and icon roles | `hsl(173 80% 27%)` / `hsl(173 80% 30%)` |
| `--brand-fill` / `--brand-on-fill` | teal fills and their contrasting foreground | `hsl(173 80% 35%)` / white |
| `--brand-focus` / `--brand-chart` | focus chrome and data-viz teal | `hsl(173 80% 25%)` / `hsl(173 80% 32%)` |
| `--ai` | AI track — enrichment, drafts, status-change proposals | `hsl(260 70% 60%)` (purple) |
| `--ai-subtle` | AI surface tint behind suggestion cards / strips | `hsl(260 80% 97%)` |
| `--ai-subtle-foreground` | AI text/icon on the subtle surface | `hsl(260 70% 35%)` |
| `--ai-border` | AI card / strip border | `hsl(260 60% 88%)` |
| `--destructive-text` / `--destructive-glyph` | readable red text and icon roles | `hsl(0 75% 36%)` / `hsl(0 75% 38%)` |
| `--destructive-fill` / `--destructive-on-fill` | destructive fills and their contrasting foreground | `hsl(0 75% 43%)` / white |
| `--destructive-focus` / `--destructive-chart` | focus chrome and data-viz red | `hsl(0 75% 32%)` / `hsl(0 75% 40%)` |

Surface tokens keep the product quiet and dense. The canonical values live in
`packages/web/src/app/styles/tokens.css`; the table below captures the intended
roles so component work uses the tokens for the same jobs:

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Page surface | `--surface-page` | `hsl(220 18% 98%)` | `hsl(220 14% 8%)` | Main app background |
| Sidebar surface | `--surface-sidebar` | `hsl(220 13% 97%)` | `hsl(220 14% 6%)` | Primary navigation |
| Elevated surface | `--surface-elevated` | `hsl(0 0% 100%)` | `hsl(220 14% 12%)` | Inputs and dialogs |
| Card surface | `--surface-card` | `hsl(220 18% 99%)` | `hsl(220 14% 10%)` | Repeated cards and KPI panels |
| Popover surface | `--surface-popover` | `hsl(220 18% 97%)` | `hsl(220 14% 14%)` | Menus, tooltips, and popovers |
| Hover surface | `--surface-hover` | `hsl(220 13% 95%)` | `hsl(220 13% 14%)` | Hover and active rows |
| Subtle surface | `--surface-subtle` | `hsl(220 13% 97%)` | `hsl(220 14% 9%)` | Quiet section backgrounds |
| Primary text | `--foreground` | `hsl(220 13% 13%)` | `hsl(220 13% 95%)` | Main text |
| Muted text | `--muted-foreground` | `hsl(220 9% 46%)` | `hsl(220 9% 65%)` | Captions and helper copy |
| Default border | `--border` | `hsl(220 13% 91%)` | `hsl(220 13% 18%)` | Standard hairlines |
| Subtle border | `--border-subtle` | `hsl(220 13% 93%)` | `hsl(220 13% 15%)` | Group dividers |

Status colors (the six issue workflow statuses) keep separate text, glyph,
fill, focus, and chart roles. Text roles meet 4.5:1 against every common
surface; glyph/focus/chart roles meet 3:1. Planning continues to use its own
`--planning-*` family.

| Status | Text | Glyph | Chart |
|--------|------|-------|-------|
| Backlog | `--status-backlog-text` | `--status-backlog-glyph` | `--status-backlog-chart` |
| Open / Todo | `--status-open-text` | `--status-open-glyph` | `--status-open-chart` |
| In Progress | `--status-in-progress-text` | `--status-in-progress-glyph` | `--status-in-progress-chart` |
| In Review | `--status-in-review-text` | `--status-in-review-glyph` | `--status-in-review-chart` |
| Done | `--status-done-text` | `--status-done-glyph` | `--status-done-chart` |
| Closed | `--status-closed-text` | `--status-closed-glyph` | `--status-closed-chart` |

Planning lifecycle colors use a separate `--planning-*` token family from issue
workflow status. The separation keeps issue `todo/open` neutral while letting an
open milestone read as an active planning target, and keeps "released" as the
only planning state that uses shipped green.

| Planning meaning | Token | Used by |
|------------------|-------|---------|
| Pending | `--planning-pending` | planned sprints and planned releases |
| Open | `--planning-open` | open milestones, rendered in brand-adjacent teal |
| Active | `--planning-active` | active sprints and in-progress releases |
| Closed | `--planning-closed` | closed sprints and closed milestones |
| Released | `--planning-released` | released releases only |

Priority colors (rendered as the priority dot fill):

| Priority | Token | Light value |
|----------|-------|-------------|
| Critical | `--priority-critical` | `hsl(0 75% 55%)` (red) |
| High | `--priority-high` | `hsl(20 85% 55%)` (orange) |
| Medium | `--priority-medium` | `hsl(40 85% 50%)` (amber) |
| Low | `--priority-low` | `hsl(220 9% 60%)` (gray) |

Issue-type colors back the `TypePill` glyph (epic/story/task/bug/spike/chore),
each pairing a distinct Lucide icon with a distinct color so the type is
distinguishable pre-attentively, not by color alone.

Color is never the sole carrier of meaning. Status is a *shape* (the
`StatusIcon` draws a different ring/fill per status) as much as a color;
priority pairs its dot with a text label; issue type pairs glyph + label;
blocked state is a labeled "Blocked" badge. This redundancy is the WCAG-AA
discipline applied at the component level.

### Dark Mode

Both modes are first-class. After client hydration, the `.dark` class on
`<html>` follows the stored light/dark/system preference; the `system` choice
consults `prefers-color-scheme` initially and on OS changes. Every semantic
token has a dark variant.

Theme synchronization has one root-level client owner rather than living in the
authenticated dashboard shell. Direct entries into login, onboarding,
not-found, and recoverable error routes therefore hydrate the same persisted
light/dark/system preference and keep following OS changes when the preference
is `system`.

### Typography

The product Latin font is **Inter**, loaded once as a variable face through
`next/font` with `font-display: swap`. Display and body roles share the same
stack: `Inter, Noto Sans KR, ui-sans-serif, system-ui, sans-serif`. **Noto Sans
KR** is the fixed variable Hangul companion, so mixed Korean/Latin copy never
falls through to a host-OS generic face. Code, IDs, timestamps, and numeric
values use **Geist Mono** first, followed by the same Noto Sans KR companion and
the generic monospace fallback; issue IDs and SHAs keep tabular numerals.
The scale is compact on purpose:

| Level | Size | Weight | Line height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Page title | `14px` | 600 | `21px` | `-0.01em` | Compact routed page headers |
| Group title | `15px` | 600 | `20px` | 0 | Settings and grouped-surface headings |
| Section label | `13px` | 600 | `16px` | `0.08em` uppercase | Settings and standard product sections |
| Body | `14px` | 400 | `20px` | 0 | Dense app text |
| Caption | `12px` | 400 to 500 | `16px` | 0 | Helper copy and metadata |
| Mono value | `13px` | 400 | `20px` | 0 | IDs, prefixes, branch-like values |
| Chart label | `12px` | 400 | `16px` | 0 | Axes, legends, and compact data labels |

Routed product surfaces use explicit contextual roles in addition to the scale
above. `type-navigation` and `type-control` are separate 13px/19.5px roles for
sidebar/settings navigation and interactive controls. The Board owns
`type-board-status` (12px/600/16px, `0.025em`, uppercase) and
`type-board-epic` (12px/600/16px, no transform), so an Epic heading cannot
inherit the status grammar. `type-card-title` is the Noto Sans KR optical
correction at 13px/500/18.5625px; `type-card-metadata` is 11px/16.5px, and
`type-card-context` is the 10.5px/16px planning-strip exception.
`type-compact-mono` is the 11px/16.5px tabular-mono role for card IDs, dates,
activity times, and other secondary identifiers; full-size IDs and values keep
`type-mono-value`. `type-detail-section` is the 11px/600/16.5px compact
uppercase role for issue form/detail section headers, while settings and report
groups retain their own `type-section-label` and `type-report-section` roles.

These roles are consumption boundaries, not aliases for arbitrary size
utilities: navigation and controls never inherit compact metadata, and compact
metadata is limited to secondary information with an accessible full-value
path. The below-caption `type-card-context`, `type-card-metadata`,
`type-compact-mono`, and `type-detail-section` roles are intentionally scoped to
the board/detail/report chrome described above. Login/onboarding brand titles
remain their separate branded scale, and the established issue Markdown body,
comment, heading, and code rhythm remains scoped to its Markdown surfaces.

The remaining pre-REEF-603 consumer contracts are explicit as well. List group
labels/counts/IDs use `type-list-group` (12px/600/16px),
`type-list-group-count` (11px/600/14.6667px mono), and `type-list-id`
(12px/400/16px mono); the shared table header keeps
`type-table-header` at 10px/500/15px with 0.5px tracking. Kanban and detail
type pills use separate `type-board-type` (10px/500/10px) and
`type-detail-type` (11px/500/14.6667px) roles, while the Kanban blocked badge
uses `type-board-blocked` (10px/600/15px, 0.25px tracking, uppercase).
Timeline status groups, titles, month headers, date ticks, and assignees use
`type-timeline-group`, `type-timeline-title`, `type-timeline-month`,
`type-timeline-tick`, and `type-timeline-assignee` respectively; their tuples
are 12px/600/16px, 12px/500/18px, 11px/600/16.5px, 10px/400/15px, and
11px/400/16.5px. Reports keep Risk map row labels and cells distinct from its
headers: `type-report-row-label` is 12px/400/16px, `type-report-cell` is
12px/400/16px tabular mono, `type-report-header` is 10px/400/15px with
0.25px tracking and uppercase, and Throughput ticks use
`type-throughput-tick` at 11px/400/16.5px. Snapshot labels use
`type-snapshot-label` at 11px/400/16.5px with 0.275px tracking and uppercase.
Settings group descriptions, section headings, group headings, and theme
descriptions use `type-settings-description` (12px/400/16px),
`type-settings-section` (13px/600/19.5px with 0.65px tracking and uppercase),
`type-settings-group` (15px/600/22.5px), and `type-theme-description`
(11px/400/16.5px). The shared segmented control, small Button, sub-issue
progress count, and DialogTitle keep their own `type-segmented-control`
(12px/500/18px), `type-small-button` (12px/500/16px),
`type-subissue-progress` (12px/400/16px), and `type-dialog-title`
(16px/600/16px, -0.16px tracking) roles. The committed historical tuple
measurement is the English/light 1440×900 run; the hermetic matrix separately
checks the composed consumers across English/Korean, light/dark, and
1440×900, 1024×800, and 390×844. These are not a new density setting or a
second font system.

Hero-scale type does not belong inside dashboard panels. Routed product
surfaces should not drop below 12px captions or 14px body copy.

Issue Markdown bodies use a compact rhythm inside the scoped
`.reef-markdown-editor` WYSIWYG surface. Top-level paragraphs are 14px with a
22px line height and 8px between consecutive paragraphs. Top-level headings
step down through H1 24px/30px, H2 20px/28px, and H3 16px/24px; each uses
600 weight and has block margins of H1 24px/10px, H2 22px/8px, and H3
20px/6px (top/bottom). The first direct block starts at 0 and the last direct
block ends at 0. These overrides stay on direct children so list and checklist
item paragraphs keep their own layout, and the global `prose-sm` defaults and
other Markdown surfaces are unchanged.

Issue descriptions and issue comments use one semantic Markdown contract. The
Tiptap WYSIWYG editor (editable and read-only) carries
`.reef-markdown-surface reef-markdown-editor`; the comment Streamdown instance
carries `.reef-markdown-surface reef-markdown-comment`. Both scopes resolve
foreground, muted foreground, brand-text, subtle surface, and subtle border from
the Reef tokens above. Headings, links, emphasis, inline and fenced code,
quotes, dividers, lists/checklists, tables, images, mentions, and focus states
therefore keep the same semantic roles without sharing a renderer or changing
the stored plain Markdown. The issue body remains 14px/22px; comments remain
the denser 13px/20px projection.

The contract is checked in Light, Dark, and both System outcomes at 1440×900
and 1024×800. At the 720px CSS viewport (the 200% equivalent), the document
must not widen: long URLs wrap, fenced code owns its horizontal scrollport,
table cells wrap, and images stay contained. Keyboard focus must remain
visible on ordinary links, task checkboxes, and the editor's edit/Source
controls. The markdown fixture screenshot evidence keeps the Tiptap body and
the comparable Streamdown comment in the same issue detail, while Source ↔
WYSIWYG and save/reload preserve the authored block order and supported syntax.

On the Issue Detail and New Issue Description surfaces, the editor exposes the
same quiet 32px hit area at its lower-right corner when the viewport is at least
1024px wide and the device reports a fine pointer. This deliberately differs
from the Issue Detail sheet's 1280px desktop breakpoint: browser zoom and
split-window layouts should not make a mouse-accessible editor control
disappear. Coarse-pointer surfaces omit the focusable handle altogether so it
does not compete with touch scrolling. The pointer-captured handle and its
horizontal separator keyboard control share a 200px minimum, a 320px initial
frame, and a maximum of `max(200px, min(960px, viewport height - 160px))`;
WYSIWYG and Source use the same body frame and scroll owner. A finite user
height is restored only for the current tab through the shared
`sessionStorage` key, while missing or malformed values use the 320px default
(or the current clamp boundary). A containing layout may provide a transient
preferred height for a maximized New Issue dialog; it is never persisted, and
pointer/keyboard input takes precedence and becomes the shared user height.
Narrow or coarse-pointer layouts keep the automatic responsive editor behavior;
Source mode retains its native vertical resize fallback when the dedicated
handle is unavailable. Planning, template, and other MarkdownEditor consumers
remain opt-out.

Inline marks inside the same scoped surface follow the same semantic hierarchy:
links use the `--brand-text` role and keep a visible underline in default,
hover, visited, and keyboard-focus states; inline code uses the existing Geist
Mono stack on `--surface-subtle` with a `--border-subtle` hairline, compact
padding, and no generated backticks; bold, italic, and strikethrough retain
`--foreground` contrast (600 weight, italic style, and a clear line-through),
including when the marks are nested. Roster-resolved issue-body mentions keep
their sanitized `data-reef-mention` marker, brand/500 treatment, and no
underline or link behavior. These rules are editor-scoped and do not alter
fenced code blocks, comments, or AI Markdown.

Issue-body images are block evidence: they keep intrinsic width and height until
the editor width or a `32rem` maximum height requires containment, use
`object-fit: contain`, and receive a 16px block rhythm with the semantic subtle
surface and border so transparent or broken images remain legible. Broken images
keep their non-empty alt text readable. These image rules are scoped to the
`.reef-markdown-editor` surface only.

Only an explicit Markdown link whose target is an AKB file URI is rendered as a
compact inline attachment action. Its authored filename remains the anchor text;
the final alphanumeric extension is shown in uppercase (or `FILE` when absent or
outside the bounded extension rule), and long labels wrap within narrow issue
panels. In WYSIWYG mode the link opens the existing issue-scoped authenticated
attachment proxy in a safe new window, while Source mode and saved Markdown keep
the raw AKB URI. Ordinary URLs, AKB document links, comments, and AI Markdown
retain their existing rendering.

Persisted known issue IDs, AKB document/file links, and resolved mentions share
one compact visual hierarchy in WYSIWYG through their semantic markers and
labels; ordinary URLs keep their existing underlined treatment. Source mode and
saved Markdown remain unchanged.

Block Markdown keeps the same controlled density. Fenced code uses the existing
Geist Mono stack at `13px/20px` on `--surface-subtle`, with a
`--border-subtle` 1px boundary, restrained radius, and compact padding; its
`pre` owns `white-space: pre` and `overflow-x: auto` so long lines scroll inside
the block without widening the editor or detail document. Blockquotes remove
forced italics and generated quote marks, using a 2px `--brand-focus` start rule and
an extremely light `--surface-subtle` surface; direct paragraphs and lists keep
their normal weight/style and first/last block rhythm inside the quote. A
horizontal rule is a single `--border-subtle` 1px hairline with 24px block
spacing. These block rules remain scoped to the issue WYSIWYG and do not change
inline marks, task lists, images, toolbar/Source controls, comments, AI
Markdown, or other global `prose` surfaces; language fences remain serialized
for the future syntax-highlighting boundary.

The shared issue editor also exposes a keyboard-first slash navigator at the
start of an empty line. `/` opens one categorized single-column listbox (TEXT,
LISTS, STRUCTURE) with a nominal 360px width, localized labels and
descriptions, and no separate search field; typing filters the same registry,
Arrow keys wrap selection, Enter inserts, and Escape closes without changing
the trigger. The popup is clamped and flips within the editor boundary, keeps
its Lucide icon and semantic Reef surface tokens, and never resolves issue IDs
or relation targets. The registry covers headings, quote, bullet/numbered/task
lists, a fixed basic 3×2 GFM table, fenced code, and a divider. Tables stay
editor-scoped with fixed layout and wrapped cells; known lowlight languages
receive bounded token colors while unknown or empty fences remain readable
plain code. Source mode and save/reload preserve the authored Markdown.

### Spacing, Layout & Density

Layout follows Tailwind's spacing scale. The frame is a fixed sidebar plus a
fluid main column:

| Token | Value | Usage |
|-------|-------|-------|
| `gap-1` | 4px | Tight label stacks |
| `gap-2` | 8px | Inline controls |
| `gap-3` | 12px | Form field groups |
| `gap-4` | 16px | Compact panel internals |
| `gap-6` | 24px | Settings group header to content |
| `gap-8` | 32px | Settings sections |

- **Sidebar** — collapsible between an expanded `w-60` and a `w-14` icon rail;
  narrow viewports use the icon rail so the main column remains usable. It holds
  the reef wordmark, a prominent New Issue button, the primary nav (Issues / My
  Work / Inbox / Planning / Reports / Settings), a footer utility
  row for keyboard shortcuts, and the workspace/account identity block.
  The workspace switcher keeps the full configured `useVaults()` candidate set,
  applies search before splitting it into localized Favorites and Other
  workspaces groups, and keeps a separate favorite toggle beside each
  navigation control. Toggling a favorite preserves the popover and search;
  selecting the workspace name alone writes the last-viewed browser pointer and
  navigates to that workspace's URL-owned Issues screen.
  App-version context lives in the account menu as a release-notes link.
- **Main column** — a per-page header and the page body. The Issues page body
  swaps between Board, List, Timeline, and Backlog.
- **Issue detail** — a right-side slide-over Sheet, internally a two-column
  layout: title, description, Sub-issues, linked documents, refs, and activity
  timeline on the left; a 400px Details/People/Planning/Parent/Relations
  property rail on the right. On desktop, the left splitter controls the panel
  between 1200px and `min(94vw, 1680px)`, with 1440px as the default working
  canvas. The three 240px steps leave about 732px / 972px / 1212px for the main
  editor after padding, gap, and the fixed property rail. The header's width
  action toggles the maximum width and restores the preceding splitter width.
  The width and toggle state live for the current browser tab session; narrow
  viewports keep the existing responsive `min(94vw, 1440px)` layout without a
  splitter or width action.
  Relation targets render as compact issue rows rather than pill chips.
- **Ask AI** — a floating non-modal panel (≈420×560) anchored bottom-right,
  above its FAB.
- **Authenticated exception surfaces** — `/onboarding` and the workspace
  access-denied screen keep the same account identity/menu in the top-right
  utility area once the session is confirmed. Recovery actions remain the
  primary content on access denial; account actions are secondary.

Density is tuned per surface: Kanban cards are scannable (status glyph, ID,
type pill, title clamp, a compact meta row); list rows are tabular and dense;
the detail panel is comfortable for reading and editing.

### Accessibility

The target is **WCAG AA**. Radix supplies keyboard operability, focus trapping
in dialogs/sheets, focus restoration, and ARIA roles. On top of that the
product adds: meaning encoded redundantly (shape/glyph/label alongside color),
visible focus rings (`focus-visible:ring-2 focus-visible:ring-brand-focus`) on custom interactive
elements including the draggable Kanban card, `role="alert"` on inline error
messages, `aria-live` toast semantics via Sonner, screen-reader-only
titles/descriptions on the issue Sheet, and keyboard activation (Enter/Space)
on the card. Shared dropdown menus focus the current or first enabled row,
support wrapping Arrow/Home/End navigation, expose checked/current state, and
return focus to the trigger after Escape or a dialog. The Kanban card is
reachable and openable by keyboard; pointer drag-and-drop is the enhancement,
not the only path to moving an issue (status can also be changed from the
detail panel's status select). Issue List rows and Kanban cards also share one
translated context menu: right-click, Shift+F10, and the Menu key open it
without opening the detail sheet or starting a drag. Its Status, Assignee,
Priority, and Sprint submenus expose the current value and a nullable None
choice; closing still requires the existing reason dialog. Copy Link uses the
canonical vault/issue URL, while Copy ID copies the issue identifier. In List,
the Status, Priority, and Assignee cells open the existing inline editor on
click or Enter and do not open the detail sheet. The portaled editor is
positioned from the activated field trigger itself, not the row's ID cell, and
re-measures after window or table scrolling so it follows sticky-column motion.

Cursor meaning follows the real interaction at the pointer location. The single
`packages/web/src/app/cursor-policy.css` module imported by the global stylesheet
owns these rules; components expose native semantics, ARIA state, or a small
semantic interaction marker rather than selecting cursor utilities locally.

| Element or state | Cursor | Interaction contract |
| --- | --- | --- |
| Enabled button, link, menu item, option, selection control, clickable row/card | `pointer` | The mouse, keyboard, or touch activation is available. |
| Editable text field, editor, or search input | `text` | Text entry and selection remain available. |
| General content or read-only value | `auto` | Browser text selection and the contextual default remain available. |
| Actually disabled control | `not-allowed` | The mouse and Enter/Space activation are both blocked, while the disabled element remains the hit target. |
| Control handling a request | `progress` | Progress takes precedence over the ordinary disabled cursor; duplicate activation remains blocked and accessible busy feedback stays. |
| Drag-only handle | `grab` / `grabbing` | The handle is grab-ready, changes only for the lifetime of the real drag, and restores after completion or cancellation. |
| Clickable card that also supports drag | `pointer` / `grabbing` | The card opens detail by default; only an active drag changes the cursor. A card in a label group is not disabled because its label move is unavailable. |
| Resize handle | Directional resize cursor | The detail splitter uses `col-resize`; the Markdown editor handle uses `se-resize`, with existing pointer and keyboard bounds unchanged. |

State is local to the actual control. A pending view transition marks only the
clicked segment, a pending field marks only its field trigger, and a pending
reorder marks only the affected row/card. Parent rows and containers do not
force a progress cursor onto unrelated children. Disabled controls keep their
native or ARIA event guards and do not use `pointer-events: none`, so the
visible `not-allowed` cursor and the browser hit target agree. Theme, locale,
keyboard focus, and coarse-pointer behavior do not change the policy; hover is
an affordance, never the only way to operate a control.

The shared account menu uses a visible focus ring, an `계정 메뉴`/`Account menu`
ARIA label, and at least a 44px trigger and action-row hit target. Its sign-out
progress and failure copy are exposed through polite live feedback.

### Focus and selection policy

Focus, selection, input context, and menu navigation are separate meanings with
separate visual owners:

- Independent buttons, links, selection controls, rows, and cards use the
  browser's `:focus-visible` decision. The shared fallback and component-owned
  rings are a solid 2px `--brand-focus`; a pointer activation does not add a
  focus border that duplicates a selected or active fill.
- Text inputs, search fields, textareas, and the Markdown editing surface use
  `:focus` or `:focus-within`. Clicking into an editing surface is itself the
  action that establishes the insertion context, so it remains visibly marked
  for pointer and keyboard entry. These rings are inset when the field owns a
  clipped lane.
- Checked, mixed, selected, active, and pressed state stays in its existing
  native or ARIA representation. A selected issue row or backlog row receives
  its selection fill, not a row-sized focus outline; the checkbox or other
  actual control owns the focus indicator. Moving focus does not clear or
  replace that state.
- A composite row may provide a quiet context fill, but its parent does not
  draw the same-strength border as a focused child. Child links, buttons, and
  quick-edit triggers own their own focus indicator. Menus and listboxes keep
  their highlighted/active item treatment and Radix roving focus rather than
  inheriting an independent button border for every option.
- Dense and clipped surfaces choose a local safe treatment: the List boundary
  is painted inside its scrollport, the first-column selection hit target uses
  an inset outline, Backlog uses an inset boundary, and the shared input/editor
  context uses inset rings. These choices preserve sticky columns, row heights,
  overflow owners, and the existing keyboard scroll regions instead of changing
  global overflow to hide a clipped edge.

The global `*:focus-visible` rule is a fallback for native and custom
interactive elements without a more specific owner. Component styles that own
their ring explicitly suppress that fallback, so one target does not render two
competing outlines. The contract is checked in Light and Dark at the standard
and narrow desktop viewports, including the four edges of the List/Backlog
scrollports and the visible input context in composed dialogs and detail
surfaces.

### Surface, Depth & Motion

reef uses borders plus tonal shift rather than decorative elevation. Hairlines
separate dense work areas; elevated surfaces are subtle and shadowless by
default. Cards are reserved for repeated items, dialogs, proposal cards, and
genuinely framed tools. Page sections stay unframed unless an existing shared
component already frames them.

Motion uses one signature curve and a small duration scale defined in
`packages/web/src/app/styles/tokens.css`:

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | `--duration-fast` 120ms | `--ease-signature` | Button and row hover |
| Standard | `--duration-base` 150ms | `--ease-signature` | Sort and filter transitions |
| Emphasis | `--duration-slow` 500ms | `--ease-signature` | Drag/drop settle |

Animate color, opacity, and transform. Avoid layout animation unless a shared
library already owns the interaction, and give every interactive control a
visible hover and focus affordance.

## Core Surfaces

### Issues Workspace — Scope and Layout

The sidebar workspace switcher is navigation chrome shared by every dashboard
surface. Its URL segment remains the active workspace identity, while the
versioned browser-local favorites preference only controls discovery order. It
shows only accessible workspaces with Reef configuration, removes stale or
malformed local names as the candidate list is reconciled, and degrades to an
empty Favorites group when browser storage is corrupt or unavailable. Favorite
and workspace controls are independent keyboard targets with localized names
and pressed state; saving a preference never blocks workspace navigation or
workspace creation.

`/workspace/{vault}/issues` is one workspace with two independent URL axes:
`scope=active|backlog` selects the work collection and `view=board|list|timeline`
selects its rendering layout. Active supports Board, List, and Timeline;
Backlog supports Board and List, and a Backlog + Timeline URL is normalized to
List. Every dashboard surface is vault-scoped under `/workspace/{vault}/…`
(REEF-315): a malformed vault segment 404s, a well-formed vault the signed-in
user cannot access shows an explicit access-denied surface (with their own
workspaces to switch to). Vault-less dashboard paths are not part of the route
tree; use the explicit workspace URL or the root workspace picker. The old
mixed `view=backlog` URL is not a supported route.

The Issues page header keeps two separate semantic controls in distinct areas:
the always-text `Active | Backlog` scope control sits in a stable,
title-adjacent scope area, while the `Board | List | Timeline` layout control
stays in the right action area. Switching scope preserves the current layout
when supported, keeps filters and search, and normalizes Backlog away from
Timeline. Backlog has no count, badge, or notification dot; counts appear in
Board group headers or List content. At narrow widths, the title-adjacent scope
area remains before the layout actions in the header's wrap order and both
controls stay contained in the viewport.
The Active header reserves the current-sprint shortcut's width while its
catalog loads or has no active sprint, so the header does not rewrap when the
shortcut appears or disappears.

Board, List, and Backlog render one shared sort control in the filter toolbar
immediately after Display options, so sorting stays in the same collection-tool
group and joins its responsive wrapping flow. Backlog's visible defaults are
`Group: Priority` and `Sort: Rank`; Timeline remains date-ordered and omits the
field/direction sort while preserving the shared filter and URL state.

The workspace roots follow the same URL-first contract (REEF-424).
`/workspace` is the only workspace route that consults the remembered Dexie
default: it opens that vault's Issues surface or sends a signed-in browser with
no default to onboarding. `/workspace/{vault}` keeps the explicit vault,
preserves all query values, and redirects to that vault's
`/workspace/{vault}/issues` surface.
Malformed, inaccessible, and Reef-unconfigured vault roots never fall back to a
different remembered vault or overwrite the browser default.

**Kanban Board.** The board presents its issue collection as buckets by Status,
Priority, Assignee, Sprint, Label, or Epic; Status uses the five workflow columns
(Open, In Progress, In Review, Done, Closed). The grouping choice is the
`?group=` part of the shareable workspace URL and survives reload, back/forward,
and Board/List switches; Board defaults to Status. A short drag distance
distinguishes a drag from a click, so a click opens the issue's detail slide-over
and a drag moves it. Status, Priority, Assignee, and Sprint buckets accept drops,
including a None bucket for nullable fields; same-value drops make no request.
Dropping onto **Closed** opens a close-reason dialog (closing requires a reason).
Label buckets are explicitly read-only, with a translated hover/focus
explanation, while card click and keyboard detail opening remain available. Each
card shows a status glyph, the monospace ID, a type pill, an optional "Blocked"
badge, the title (two-line clamp), and a compact meta row (priority dot + label,
assignee, start/due dates, sprint/release chips). Blocked state is computed from
the dependency graph projected over the whole vault, so badges stay correct even
when the board view is filtered.
Kanban columns use the subtle surface for their group frame, while repeated issue
cards use the card surface; cards do not use the brighter elevated surface.

When grouped by Epic, each root Epic is one flat column with read-only group
dragging. Its header shows the Epic id, full title, own status, visible
direct-child count, and the done-or-closed count over those visible children;
a translated note explains the relationship restriction.
Child cards retain their existing click, keyboard detail, quick-edit, and
context-menu actions. Root Epics are headers only, never child cards; a filtered
parent remains available through the compact whole-workspace relation catalog.
Issues without a parent or with a non-Epic or unsupported deeper parent use the
localized **No epic** fallback, while a parent id absent from the catalog uses
**Unavailable parent**. Epic columns do not accept drag-and-drop; parent
changes continue through Issue Detail.

**List.** A dense, sortable table rendering the same issues with their field
leaves. Active defaults to no grouping, and can group by None, Status, Priority,
Assignee, Sprint, Label, or Epic. Backlog defaults to Priority grouping. Each populated bucket has a sticky, keyboard-focusable
header with a localized label, count, and `aria-expanded` collapse control;
collapsed rows leave the virtual item count and header count intact while their
DOM rows are removed. Multi-label issues occur once under each distinct label,
but selection and mutation still use the issue id. Group headers and rows share
the existing TanStack Virtual projection, cursor loading, bounded DOM,
selection, focus, quick-edit, sticky-column, and anchor-preservation behavior.
Grouping is UI-local: it is not stored in Dexie or akb, while the group choice
itself remains in the URL for sharing and navigation. At narrow mobile widths
the default sticky prefix compresses inside the List scrollport so child titles
and controls remain readable without page-level horizontal overflow; optional
columns retain the table-local scroll. Timeline ignores the group choice.

Epic List headers additionally expose the root Epic id/title/status and visible
done-or-closed progress. The Epic title action opens the existing issue detail
route, while the separate chevron control collapses or expands its child rows;
collapsed children are absent from the virtual model and keyboard focus order.
An Epic-only match therefore leaves a zero-count header in place, and root Epic
rows are never duplicated beneath that header.

**Multi-select and bulk edit.** List owns multi-select because its leading
checkbox column and field-comparison layout fit batch work. Rows expose compact
14px checkbox indicators on hover, focus, or selection; the native input keeps
checkbox semantics while the visual indicator uses the elevated surface when
idle and one solid brand fill with a contrasting check when selected.
Each checkbox sits in one labeled 32px hit target so the leading-cell dead zone
never opens issue detail.
Shift+Click extends an inclusive
range in list order, while normal clicks still open issue detail. The header
selects only the currently loaded filtered ids and announces unchecked, mixed,
and checked states. Once at least one issue is selected, an integrated toolbar
between the filters and table directly exposes Status, Assignee, Priority,
Sprint, Add labels, and Remove labels; Clear closes selection mode. The action
group stays on one row when space permits and wraps to a second row at narrow
desktop widths instead of hiding fields behind an overflow menu. Selection uses
the brand-teal surface (never AI purple), suppresses
single-issue quick-edit shortcuts, clears on view/filter/workspace changes, and
yields to an open dialog, popover, or input before Esc clears it.

Board deliberately has no card checkbox, range selection, selected-card chrome,
selection-driven drag mode, or bulk-edit action. Its card header remains
reserved for status, id, type, and blocked state; normal click, quick edit, and
drag keep their existing meaning. Bulk editing remains available from List.

Bulk writes run through the existing single-issue Route Handler one at a time.
Each item is optimistic, a failure rolls back only that item, successful and
unchanged items leave the selection, and failures remain in a viewport-bounded
tray with their id, title, PM-facing reason, and recovery action. Retry is
offered for conflicts and transient request failures; a not-found item is
removed from the stale selection instead. A close action asks for one reason and
applies it independently to every target; sprint assignment promotes backlog
issues to Todo, while moving to Backlog clears sprint. The toolbar stays in
normal page flow, wraps within ordinary and narrow desktop widths, and never
competes with the Ask AI control or covers issue content.

**Timeline.** A date-windowed schedule view of the same set.

**Backlog.** A Priority Board and Rank-ordered List of `backlog` issues share
the issue-wide Rank meaning. Board columns are Critical, High, Medium, Low, and
None; cards retain Rank order within a column. A same-column drag changes only
Rank, while a cross-column drag changes Priority and the final Rank. Backlog
List keeps the shared inline quick edit for Status, Priority, and Assignee,
manual rank order, and drag-to-reorder when no explicit sort is active. These
field triggers keep the same mutation, close-confirmation, cache, keyboard, and
anchor behavior as List; Labels and planning fields are not exposed in this
triage lens. Empty and no-match states are distinct: an empty backlog explains
how deferred work arrives there, while filtered-out results offer a Clear
filters action.

At narrow widths (320–768px), the Issues header wraps its title and actions
without hiding controls. List, Backlog, and Timeline keep wide data inside
named, keyboard-focusable scroll regions rather than expanding the document;
the Board keeps its existing mobile grid containment. List and Backlog rows
open on Enter or Space, while links, quick-edit buttons, and checkboxes retain
their own native keyboard behavior. Search has an explicit accessible name,
selection controls remain visible without hover, and loading or retryable
errors are announced through live status surfaces.

The board shows a column-skeleton while loading, the list and backlog show row
skeletons, and timeline/settings have route-level skeletons shaped to their
content. A soft inline notice appears if some issues fail to load (cached data
is still shown). An unconfigured workspace shows a "Configure a workspace in
Settings" empty state.

**Filter toolbar menus.** Display is a compact checkable menu with independent
Show archived and Show completed toggles; it stays open while the PM changes
multiple options and hides the completed toggle in Backlog. Active List also
keeps its optional-column choices in this same Display menu, so the List has no
settings-only row above its table. My Views keeps
view selection separate from management actions: update, rename, duplicate,
and delete are direct keyboard-navigable menu items grouped under each saved
view, while loading failures, active/changed state, and empty state remain
visible in the main menu. Saved names truncate in constrained layouts but
retain their full value in a title or accessible label. A My View captures the
current filter, scope/layout, grouping, ordering mode and direction, display
options, and List optional columns in the browser-local snapshot.

The shared filter bar exposes one generic issue-date range through one 32px
compound trigger. Its closed state is the selected criterion (`Updated date`,
`Created date`, `Start date`, or `Due date`, localized per locale), while a
valid range adds the two date bounds to that summary; one group-level clear
action uses the same active chrome. Opening the trigger reveals one popover
editor with a single criterion selector, persistently labeled start/end fields,
and field-near correction messages. Updated and created dates use local browser
midnight boundaries around timestamp instants; start and due dates compare the
stored calendar dates without timezone conversion, excluding issues where the
selected nullable date is unset. There is no automatic initial range. An
incomplete or reversed range stays visible for correction with an inline error
and does not narrow the results. The selected range travels with the existing
URL, browser-local filter, and My View state without changing sort, grouping,
layout, or display columns.

### Issue Detail Slide-Over

Opening an issue routes to `/workspace/{vault}/issues/[id]`, intercepted by a
parallel route (`@modal/(.)issues/[id]`) so it renders as a right-side Sheet over
the board without a full navigation; a hard navigation or deep link renders the
same panel through the base route. The chrome is identical either way.

Editing is **inline auto-save**: there is no Save button and no
dirty state. Local state mirrors the loaded issue for responsive typing, and
each field commits on its natural boundary — selects, labels, and relations on
change; title and body on blur. A small header indicator shows Saving… /
Saved / Save failed, and stays silent until the first write. Because akb is
last-write-wins and its row update is read-merge-rewrite, the panel serializes
per-field commits into a chain so two quick edits can't clobber each other. A
failed write rolls back optimistically and surfaces a PM-vocabulary toast.

The panel composes the field leaves rather than a configurable mega-view: the
header carries the status glyph, ID, type pill, and (when applicable) an
Archived badge; the left column holds the title input, the markdown
description editor, the relationships editor, the external/implementation refs
editor, linked documents, and the unified activity timeline; the right rail
holds Details (type, status, priority, severity, labels), People (assignee,
requester, reporter), and Planning (dates, sprint, milestone, release, points).
A "more" menu offers Archive/Unarchive and a confirmed Delete.

The detail panel's expression of "show the why" is split by intent:
relationships show issue-to-issue context, linked documents show akb-native
reference edges, implementation refs hold external/code references, and the
activity timeline merges comments, status changes, and reconstructed events into
one chronological thread. Relationship dropdowns, navigable relation rows, and
sub-issue rows use the same compact issue-row rhythm as the rest of the detail
panel; their issue-type mark is glyph-only in the visual row, with the localized
type name kept for screen readers. Sub-issue rows also show a read-only assignee
avatar and display name (or a localized unassigned label), with long names
truncated inside the row and available through their own tooltip and accessible
name.

The chrome also carries an actor-scoped notification control. Its trigger names
and shows the effective **Watch / Watching / Muted** state, while the menu
offers Watch and Mute. Changes update optimistically, block duplicate input
while pending, and reconcile with the server after success or rollback with a
toast after failure. The preference is account-backed rather than browser-local
and is refetched when the panel mounts or the window regains focus.

Comments in that timeline are threaded without deep visual nesting. A top-level
comment anchors one timeline position; replies stay beneath it behind a single
hairline, including replies to replies. Reply controls open one inline composer
at a time, name the direct parent author, preserve the draft with an inline
error on failure, and close on cancel or success. The root timestamp determines
the thread's position among system events, while replies sort within the thread.

### Notification Inbox

`/workspace/{vault}/inbox` is the signed-in actor's collaboration inbox for
activity and comment notifications. It is backed by the persisted
`reef_notifications` state, so unread/read/archive changes survive a refresh
and another device. The sidebar badge is derived from the unread list with a
maximum query of 100 rows: the visible pill caps at `9+`, while assistive text
announces `100 or more unread notifications` (or the equivalent localized
wording) when the boundary is reached.

The Inbox list is independent from the on-demand AI surfaces. Each row shows
the event type, actor, related issue, occurred time, and read state. Opening a
row marks an unread notification read before navigating to the issue Activity
section when that issue is available. Mark unread and Archive are server
state transitions; the browser does not persist notification data or a
last-visit marker. Empty, loading, and fetch-failure states remain distinct.

### Ask AI

A teal **FAB** (bottom-right, `Sparkles`) toggles a floating, non-modal Ask AI
panel; both hide entirely when the deployment has no AI configured. The panel
is a multi-turn chat (`useWorkspaceChat` over `/api/agents/runs` with
`task_id: "chat.workspace"`) backed by the **read-only grounding agent** — it
answers questions about the codebase (file locations, references, how
something works) and holds no mutating tools. It stays mounted so history
survives close/open, shows an unread dot when replies arrive while closed, and
offers a "New chat" reset and Esc-to-close. Its empty state primes the user:
"Ask about your codebase — file locations, references, how something works."

### Authentication & Onboarding

reef is gated by an AKB account. `/login` reads AKB's authentication capability
and renders password login, workspace SSO, or both. Password login posts to
`/api/auth/akb/login`. Workspace SSO delegates the Keycloak authorization and
one-time code exchange to AKB rather than treating the Keycloak access token as
an AKB API credential. Both paths finish with an AKB-issued JWT in the
`__reef_session` httpOnly cookie; Reef keeps no server-side session table. After
either path succeeds, the previous account's workspace-scoped browser state is
reconciled away. There is no GitHub-OAuth sign-in, popup, or
management-repository selection.

After session validation, reef checks the user's accessible workspaces before
showing onboarding. If at least one already has reef configuration, the app
restores a valid last-viewed workspace or deterministically chooses one, saves
that browser fallback, and replaces the current history entry with its Issues
URL. During this check the creation form stays hidden; a failed list request
shows an explicit retry state.

Users with no configured workspace enter `/onboarding`. Its required step is
**Create a project workspace**: name a new akb vault (lowercase/digits/
hyphens), choose an issue **prefix** (uppercase, e.g. `REEF`), optionally add a
description and monitored repositories, and create. Raw vaults do not count as
configured workspaces and therefore do not bypass onboarding. Monitored
repository access comes from deployment-managed GitHub
credentials, so onboarding configures a *workspace*, not a Git repo, and no
issue is committed under anyone's GitHub identity.

The authenticated onboarding and access-denied surfaces retain the shared
account menu, including the current identity, theme shortcut, release notes,
and the same sign-out flow used by the dashboard sidebar. The menu is absent
while the session gate is checking, on unauthenticated surfaces, and on
`/login`; signing out clears AKB-scoped browser state and returns to `/login`.
An SSO session may continue through AKB's Keycloak logout route after Reef
clears its own authentication cookies.

### Planning, Reports, Settings

The remaining nav destinations are first-class pages: **My Work** (the signed-in
user's overdue and due-soon work), **Planning** (sprints, milestones, releases
that issues link to), **Reports**, and **Settings**. Settings separates
per-user preferences from team-shared workspace settings such as project prefix,
monitored repos, templates, and authoring language. These pages share the
standard page header + body chrome and the same field leaves where issue fields
appear.

Planning sprint names open the vault-scoped `/workspace/{vault}/planning/sprints/{id}`
detail surface through ordinary anchors, as does the current-sprint shortcut in
the shared Active Issues header. The shortcut is absent from Backlog and from
the fixed-sprint detail surface, so planning context is not duplicated. The
detail header shows the planning status, date range,
end-date posture, goal disclosure, health verdict, and resolved/total rollup.
Its body reuses the Issues Board and List with a locked `sprint_id` facet; the
unlock action returns to the general Issues surface. Missing sprints show a
Planning recovery link, while catalog and issue load failures stay explicit and
retryable. A named, non-rendering burnup slot remains below the header for a
future reporting card.

Settings groups follow a consistent dense form pattern: a group header with the
title, optional scope, optional access badge, description, and hairline, followed
by vertically stacked sections. The access badge is omitted while role
resolution is pending. Editor rows pair explicit labels and helper copy with
controlled inputs and a Save button; skeletons cover loading, inline alerts use
`aria-invalid` / `role="alert"` where appropriate, and users without write
access see read-only text instead of disabled mystery controls.

## User Journey Flows

### Journey 1 — Create an Issue with AI Enrichment

1. The PM opens the New Issue dialog from the sidebar button or **⌘N** (the
   dialog is a single shell-mounted instance shared by every trigger).
2. They type a title (the only hard requirement) and, optionally, a description
   in the markdown editor. A template can pre-fill the skeleton.
3. They click **Enrich with AI**. A purple review strip appears ("Analyzing
   fields…"); the agent reads existing issues and, if a monitored repo is set,
   grounds in code read-only.
4. Suggestions arrive and render *inline on each targeted field*: the control
   is replaced by a review card showing current→suggested (with a word/line
   diff for title/body), confidence, an optional "Review" flag for
   low-confidence items, and the agent's reasoning.
5. The PM applies or dismisses each suggestion, or uses **Apply all** /
   **Dismiss all** in the strip; counts of "to review / applied" track
   progress. Applied values are written into the form, not the issue.
6. They click **Create issue**. The ID is allocated server-side, a success
   toast confirms, and the new issue's detail panel opens.

Enrichment is always explicitly triggered (never on keystroke), always
reviewable, and always optional — an issue can be created with no AI
involvement at all, and a missing AI deployment simply disables the button.

The New Issue dialog keeps its writing chrome predictable at every supported
viewport. On desktop, the title and workspace context share a row with the
Template and Enrich with AI actions. At narrow widths, those actions reflow
below the context and retain their full labels and hit targets. The title and
Description remain the first, readable column; metadata follows as a single
rail below it. The dialog stays within the dynamic viewport and its bottom
safe area, while only the form body scrolls. Header context and the Cancel /
Create issue footer remain visible and keyboard reachable throughout a long
draft, including when the viewport height is reduced.

On a supported desktop, a visible Maximize/Restore toggle appears when either
the 1680px canvas cap or the `100dvh - 2rem` height would gain at least 32px
over the measured default canvas. Maximizing widens the main Description
workspace while preserving the 400px metadata rail, the fixed header/footer,
the single form-body scroll owner, and the mounted draft. Its Description
height is a transient preferred value; the REEF-545 editor clamp and any
direct pointer/keyboard height input still win and keep the shared current-tab
height. The create-only expanded flag uses its own session key, restores for
the same tab, ignores malformed values, and is hidden when the gain threshold
is unavailable or the layout becomes narrow. There is no large geometry
transition, and the control exposes localized visible text, tooltip, and
`aria-pressed` state with ordinary keyboard focus behavior.

### Journey 2 — Ask AI with monitored-repository grounding

1. The PM opens the Ask AI panel and asks a question about an issue or the
   codebase.
2. Reef reads the workspace and, when configured, the monitored repository
   read-only for grounding.
3. The panel streams the answer and shows its context; no background scan or
   issue mutation runs.

## Component Strategy

reef composes a small set of shared, single-purpose leaves rather than one
configurable view, exactly as the field-display rule requires. The components
that exist and define the experience:

- **Field leaves.** `StatusIcon` / `StatusBadge` and `PriorityDot` /
  `PriorityBadge` (`packages/web/src/components/ui/`); `TypePill`, `BlockedBadge`,
  `DateDisplay`, `EnumBadge`, `EnumSelectField`, and the `fieldValue`
  primitives (`packages/web/src/components/fields/`). Surfaces (Kanban card, list row,
  detail, dialogs) import these by file and compose them; there is no barrel
  and no `UnifiedIssueView`.
- **Board.** `KanbanBoard`, `KanbanColumn`, `KanbanCard` (with a drag preview).
- **Issue surfaces.** `IssuesWorkspace`, `IssueDetailSheet`, `IssueDetail`,
  `NewIssueDialog`, the list table/row, `BacklogView`, the filter toolbar,
  linked documents, the activity timeline, and the relations/refs editors.
- **Planning detail.** `SprintDetailPage`, `SprintDetailHeader`, and the
  hydration-shaped sprint detail skeleton compose the dedicated sprint route
  from the existing planning and issue leaves.
- **AI surfaces.** `EnrichmentReviewBar` (the purple strip with loading/empty/
  error/progress states), `FieldSuggestion` (the inline per-field review card),
  `ConfidenceBadge`, `TextDiff` (word/line diffs), and the Ask AI
  `AskAiFab` / `AskAiDialog` / `ChatSurface`.
- **Shell.** `DashboardShell` (sidebar, nav, account/release context, global
  dialogs), page header/body, the global search palette, the keyboard-shortcuts
  sheet, and the offline banner.
- **Empty states.** `EmptyState`
  (`packages/web/src/components/ui/empty-state.tsx`) is the shared leaf for
  prerequisite and section-level empty content. Callers import it directly and
  provide existing translated title/description copy; navigation and recovery
  controls stay in the surrounding page composition rather than inside the
  frame.

The AI components share the `--ai` token family so that AI work reads as a
consistent purple track wherever it appears, distinct from the teal brand.

## UX Consistency Patterns

### Feedback

Three feedback sources are treated distinctly:

- **Human actions** — successful saves/creates use Sonner toasts; routine
  inline edits in the detail panel are silent except for the header Saving…/
  Saved indicator; filters/sorts re-render silently.
- **AI actions** — always purple. Enrichment shows a loading strip, then
  per-field review cards with visible provenance and confidence.
- **System errors** — translated to PM vocabulary, shown inline with
  `role="alert"` or as a toast, never as Git or raw backend errors.

The button hierarchy is consistent: one primary action per context (e.g.
Create issue, Approve); AI confirmations use the purple `bg-ai` button (Apply,
Apply all, Approve a draft); supporting actions are ghost/outline; destructive
actions (Delete) are red and confirmed.

### CTA Role Matrix

CTA placement belongs to the surrounding page composition, not to the shared
`EmptyState` frame. The same role and visual hierarchy apply at desktop and
390px widths, in Light and Dark themes, and in both locales.

| Surface / state | Role | Form and placement | Applies when |
| --- | --- | --- | --- |
| My Work: assigned work is empty | Passive | No PageHeader action and no frame action | There are no issues assigned to the signed-in user |
| My Work: caught up | Passive | No PageHeader action and no frame action | Assigned issues exist, but none are open |
| My Work: populated | None | Existing summary and queue only | Open work is available |
| Planning: true empty | Primary create/continue | One existing filled `PageHeader` New button | The selected planning kind has no entries |
| Reports: true empty | Primary create/continue | One filled `PageHeader` New issue button opens the shared issue creation flow; the section frame remains passive | Reports has no active issues |
| Board: filtered no-match | Recovery | Existing outline control outside the section frame | Active filters produce no matches |
| Inbox: normal empty | Passive | No CTA | There is no notification to review |
| Workspace navigation | Navigation | Existing sidebar Issues link and Issues view switcher | All My Work states; navigation is not duplicated in an empty frame |

The My Work passive states keep their title, description, and personal scope
copy. Removing the duplicate Board action does not change the existing Issues
or Board navigation, and keyboard focus follows the remaining visual order.

### Empty & Loading States

Loading uses TanStack Query's `isPending` with shadcn `<Skeleton>` placeholders
shaped like the content they replace (column skeletons on the board, table rows
for list/backlog, a structured skeleton in the detail panel, and settings group
skeletons), plus a slow shimmer. The **AI enrichment loading state is purple-tinted** — the
  `EnrichmentReviewBar`'s "Analyzing fields…" strip uses the `--ai-subtle`
  surface with a spinning indicator, so AI work is visually distinct from
  neutral content loading.

Empty states explain the state and offer a next step where one exists: an
unconfigured workspace points to Settings; an enrichment that returns nothing
says "No additional suggestions." Passive states still provide their
explanation, so a screen is never left blank.

The shared `EmptyState` uses two deliberate presentation variants. The
`structure` variant is an unboxed, centered prompt for a page that cannot be
composed without a prerequisite such as an active workspace. The `section`
variant is the canonical framed treatment for an empty collection or report:
`mx-auto h-48 min-h-48 w-full max-w-4xl rounded-lg border border-dashed
border-border-subtle bg-surface-subtle px-6 py-12 text-center`. It requires one
title `h2` and one supporting description `p`; it has no icon or action slots.
Page-level actions such as Planning's create button or a Reports parent-scope
recovery control remain outside the frame so the four section states keep
identical geometry and content hierarchy.

### Empty-state accessibility & responsive proof matrix

Every framed section empty state is a semantic `section` whose accessible name
and description reference its visible `h2` and `p` by hydration-safe, instance-
unique ids. The frame therefore exposes one named region without duplicating
copy in ARIA-only attributes. The prerequisite `structure` prompt stays an
unboxed `div`; when it has no visible title, it does not introduce an unnamed
region landmark. Board's no-match overlay follows the same visible-content
reference pattern while preserving its column canvas and non-modal recovery.

| Surface / state | Semantic and interaction proof | Responsive proof |
| --- | --- | --- |
| My Work empty / caught-up | Named region, passive, no frame or header CTA | 1440px Light; 375px and 320px Dark Korean; 200% zoom |
| Inbox empty | Named region, passive, no CTA | Same viewport, theme, locale, and zoom matrix |
| Reports true empty / no-match | Named region; one PageHeader create action or outside-frame recovery | Header wrapping and focus remain inside the viewport |
| Planning kind empty | Named region; one PageHeader create action and dialog focus return | Kind switching, keyboard activation, and narrow wrapping |
| Board no-match | Named overlay, keyboard Clear filters, columns and internal canvas preserved | Page chrome and recovery stay in view; canvas may scroll horizontally |
| Loading / error / populated | No empty region is rendered; existing loading, error, and content semantics remain | Existing width and recovery behavior remain unchanged |

The proof uses real rendered Light/Dark colors for text, muted copy, borders,
controls, and focus indicators. It checks document-level overflow, clipped copy,
bounding-box containment, keyboard activation, and focus restoration rather
than inferring behavior from class names alone.

### Error Handling

Errors follow "what happened + what you can do." Network and load failures
offer Retry; enrichment failures show a PM-vocabulary message with **Try
again** and never block creating the issue without AI; the rare save conflict
is surfaced as a save conflict, not a merge conflict. AI degradation is
silent and total — when the deployment lacks AI, the affordances vanish and the
core product is unaffected.

Unmatched URLs and recoverable App Router render failures use one shell-free
Reef error family: mark and wordmark, a short catalog-backed title and
description, and only the actions that are safe without assuming authentication
or workspace state. A 404 keeps the real HTTP 404 and offers one `/` home
action. A recoverable render error offers Next.js retry plus the same `/` home
path. Neither surface guesses a vault, depends on browser history, or exposes an
error message, stack, or digest.

### Keyboard Shortcuts

Global shortcuts are registered once at the shell from the same app-action
catalog used by the command palette and keyboard-shortcuts sheet: **⌘I** opens
New Issue (**⌘⌥N** on Firefox), **⌘K** toggles search and commands, **⌘⇧A**
toggles Ask AI, **⌘?** opens the keyboard-shortcuts sheet, and **Esc** closes
the active panel. Text-field focus is respected so typing is never hijacked.
When List selection is active, the single-issue `s` / `a` / `p` / `l`
shortcuts are suppressed and Esc clears the selection only after any focused
interactive overlay has had the chance to consume it.

### Global Search

The `⌘K` palette keeps metadata search authoritative: server order, canonical
exact-ID promotion, recent issues, relation commands, `shouldFilter={false}`,
and native modified-click behavior remain unchanged. Once a trimmed query has
at least two Unicode code points and fits the 180 UTF-16 code-unit
content-search bound, a second query searches issue task-document bodies
semantically and comment bodies as case-insensitive literal text. Those hits
appear in a single **Issue content matches** group below the authoritative
**Issue field matches** metadata group. Body and comment provenance sits
immediately before each bounded snippet as muted inline text, while the issue
row retains ownership of selection, hover, and focus emphasis. The accessible
row order is issue ID, title, source, then snippet; the visual separator between
source and snippet is decorative. Literal highlighting remains text-node-only,
and issues already visible in metadata are omitted from the auxiliary group.

Content search owns no error or empty message. A failed, degraded, unsupported,
or empty content response hides the entire auxiliary group without a toast and
leaves metadata search usable. Its initial and expansion requests participate
in the palette's teal progress hairline, `aria-busy`, and polite live status.
Expansion re-requests the same query at limits `10 → 20 → … → 50`, retains the
settled rows while loading, and never presents an estimated corpus total.

An empty palette places a compact **Commands** entry above the eight recent
issues. A leading `>` or that entry switches the existing dialog into local
command mode; metadata and body/comment search remain disabled until the
palette returns to search mode. Commands use localized labels and aliases,
support nested pages with a visible breadcrumb, keep the input as the sole
keyboard focus, pop a page with Esc or empty-query Backspace, and close from
the root with Esc.

Navigation and view commands stay scoped to the active vault. View changes
preserve the Issues workspace's filter, search, sort, and ordering query.
Single-issue status, assignee, and priority commands resolve the detail issue
before a focused list/board issue and disappear while multi-selection is
active. Mutations re-read the latest cached entity, skip same-value patches,
and route Closed through the existing close-reason dialog. Focus returns to
the invoking control for same-surface actions; navigation, locale changes, and
dialog handoffs deliberately transfer it.
