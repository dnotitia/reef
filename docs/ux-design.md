# UX Design Specification — reef

reef is a mode-aware web application for AI-assisted project management. This
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
viewport usable without clipping or overlap. The product is a BFF in front of
the AKB backend. Local auth is stateless; SSO has one server-side exception for
encrypted, expiring token custody behind an opaque browser handle. Product and
UI state still follow a strict owner split:

- **Zustand** holds UI state only — sidebar collapse, the active issue view,
  filters, the open/closed state of the New Issue and Ask AI dialogs, user
  preferences. Components read it through granular selectors.
- **TanStack Query** holds server state — issues, planning catalog, activity
  inbox, linked documents, refs, activity timelines, and workspace config —
  fetched through Route Handlers via `apiFetch`. All loading and error
  affordances derive from its per-query `isPending` / `isError`; there is no
  global loading flag.
- **Dexie (IndexedDB)** holds per-user persisted browser state with no akb home
  — the *last viewed workspace* default (since REEF-315 the active workspace is
  the `/workspace/[vault]` URL segment, source of truth; Dexie is only the
  per-browser fallback the root redirector and the `(legacy)` flat-link shim use
  to choose a workspace), theme preference, UI locale (mirrored to a
  non-httpOnly `NEXT_LOCALE` cookie so SSR can resolve it on the first request),
  per-vault issue filters, the currently selected activity-scan repo, last
  visit/scan markers, and the previously signed-in akb user id used for account
  reconciliation.
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
and the existing issue set, then proposes structured issues and status
movements that a human reviews. The human stays the author and the decider;
the machine handles the tedium of structure and tracking.

reef serves two personas on one data source:

**지은 — the project manager (primary, non-developer).** Lives in a board and
a list, writes issues in natural language, and expects the tool to feel like a
project-management product, not a developer console. Never wants to fill a
ten-field form, and needs to trust automated changes — which means always
being able to see *why* something changed.

**민수 — the developer (secondary).** Works in the codebase. reef observes
monitored repositories read-only and turns that activity into proposed status
changes and draft issues, so the developer's progress is reflected without the
developer maintaining tickets by hand.

The design challenge is to give these two audiences a coherent shared surface:
the PM gets a visual, conversational, transparent experience; the developer's
work flows in through grounding and detection rather than data entry.

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

The same human-in-the-loop pattern governs the second AI surface:
**Suggestions**, where the agent's autonomously detected proposals —
new-issue drafts and status changes inferred from repo activity — wait for the
PM's Approve / Edit / Dismiss. And a third surface, the **Ask AI** panel, lets
the PM interrogate the codebase conversationally with the same read-only
grounding agent.

Across all three, the design rule is identical and load-bearing: **show the
why, not just the what.** A suggestion carries its reasoning and confidence; a
detected status change carries its rationale and the count of commits/PRs that
evidence it; an issue detail panel keeps the connected context visible through
linked documents, implementation refs, and the activity timeline. AI is
positioned as a transparent collaborator, never a black box.

### Experience Principles

1. **Creation is human, tracking is assisted.** People author and decide; the
   agent proposes structure and detects progress. Human effort goes to
   judgment.
2. **Show the why, not just the what.** Every AI proposal and every detected
   change carries its reasoning, confidence, or evidence. Unexplained change
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
palette), Table, Tooltip, Hover Card, Badge, Separator, Skeleton, Spinner, and
Sonner (toasts). Feature-specific composites live in their feature folders, and
shared but custom leaves live alongside the primitives.

Concrete UX and design-system policy for reef-web lives in this document. Short
standalone design-system notes should be folded back here rather than added as
root-level siblings, so README, architecture, and package docs keep pointing at
one source of truth.

### Customization Strategy

Design tokens are CSS custom properties defined in `packages/web/src/app/globals.css`
in three tiers: raw HSL values per mode, semantic tokens (status, planning,
priority, type, brand, AI), and a Tailwind `@theme inline` mapping that exposes
them as utility classes (`bg-brand`, `text-status-done`, `text-planning-open`,
`bg-ai`, …). This is the
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
| `--brand` | reef brand — nav active rail, FAB, primary accents | `hsl(173 80% 40%)` (teal) |
| `--ai` | AI track — enrichment, drafts, status-change proposals | `hsl(260 70% 60%)` (purple) |
| `--ai-subtle` | AI surface tint behind suggestion cards / strips | `hsl(260 80% 97%)` |
| `--ai-subtle-foreground` | AI text/icon on the subtle surface | `hsl(260 70% 35%)` |
| `--ai-border` | AI card / strip border | `hsl(260 60% 88%)` |
| `--destructive` | destructive actions, blocked indicators, errors | `hsl(0 75% 55%)` |

Surface tokens keep the product quiet and dense. The canonical values live in
`packages/web/src/app/globals.css`; the table below captures the intended
roles so component work uses the tokens for the same jobs:

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Page surface | `--background` | `hsl(0 0% 100%)` | `hsl(220 14% 8%)` | Main app background |
| Sidebar surface | `--surface-sidebar` | `hsl(220 13% 97%)` | `hsl(220 14% 6%)` | Primary navigation |
| Elevated surface | `--surface-elevated` | `hsl(0 0% 100%)` | `hsl(220 14% 11%)` | Inputs, popovers, dialogs |
| Hover surface | `--surface-hover` | `hsl(220 13% 95%)` | `hsl(220 13% 14%)` | Hover and active rows |
| Subtle surface | `--surface-subtle` | `hsl(220 13% 98%)` | `hsl(220 14% 10%)` | Quiet section backgrounds |
| Primary text | `--foreground` | `hsl(220 13% 13%)` | `hsl(220 13% 95%)` | Main text |
| Muted text | `--muted-foreground` | `hsl(220 9% 46%)` | `hsl(220 9% 65%)` | Captions and helper copy |
| Default border | `--border` | `hsl(220 13% 91%)` | `hsl(220 13% 18%)` | Standard hairlines |
| Subtle border | `--border-subtle` | `hsl(220 13% 93%)` | `hsl(220 13% 15%)` | Group dividers |

Status colors (the five canonical statuses; rendered as the `StatusIcon`
glyph color and the status badge text):

| Status | Token | Light value |
|--------|-------|-------------|
| Open | `--status-open` | `hsl(220 9% 60%)` (neutral gray) |
| In Progress | `--status-in-progress` | `hsl(40 90% 50%)` (amber) |
| In Review | `--status-in-review` | `hsl(260 70% 60%)` (purple) |
| Done | `--status-done` | `hsl(150 65% 42%)` (green) |
| Closed | `--status-closed` | `hsl(220 9% 50%)` (gray) |

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

The product font is **Inter** (loaded via `next/font`, with a separate
display instance for headings/brand); code, IDs, and timestamps use **Geist
Mono**. Issue IDs and SHAs render in the monospace stack with tabular numerals.
The scale is compact on purpose:

| Level | Size | Weight | Line height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Page title | `text-xl` to `text-2xl` | 600 | Tight | 0 | Main app page headers |
| Group title | `15px` | 600 | Normal | 0 | Settings group headings |
| Section label | `13px` | 600 | Normal | Wide uppercase | Settings section labels |
| Body | `14px` | 400 | Normal | 0 | Dense app text |
| Caption | `12px` | 400 to 500 | Normal | 0 | Helper copy and metadata |
| Mono value | `13px` | 400 | Normal | 0 | IDs, prefixes, branch-like values |

Hero-scale type does not belong inside dashboard panels. Routed product
surfaces should not drop below 12px captions or 14px body copy.

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
  Work / Inbox / Planning / Suggestions / Reports / Settings), a footer utility
  row for keyboard shortcuts, and the workspace/account identity block.
  App-version context lives in the account menu as a release-notes link.
- **Main column** — a per-page header and the page body. The Issues page body
  swaps between Board, List, Timeline, and Backlog.
- **Issue detail** — a right-side slide-over Sheet, internally a two-column
  layout: title, description, Sub-issues, linked documents, refs, and activity
  timeline on the left; a 400px Details/People/Planning/Parent/Relations
  property rail on the right. On desktop, the left splitter controls the panel
  between 960px and `min(94vw, 1440px)`, while the header's width action toggles
  the maximum width and restores the preceding splitter width. The width and
  toggle state live for the current browser tab session; narrow viewports keep
  the existing `min(94vw, 1200px)` layout without a splitter or width action.
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
visible focus rings (`focus-visible:ring-brand/40`) on custom interactive
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

The shared account menu uses a visible focus ring, an `계정 메뉴`/`Account menu`
ARIA label, and at least a 44px trigger and action-row hit target. Its sign-out
progress and failure copy are exposed through polite live feedback.

### Surface, Depth & Motion

reef uses borders plus tonal shift rather than decorative elevation. Hairlines
separate dense work areas; elevated surfaces are subtle and shadowless by
default. Cards are reserved for repeated items, dialogs, proposal cards, and
genuinely framed tools. Page sections stay unframed unless an existing shared
component already frames them.

Motion uses one signature curve and a small duration scale defined in
`globals.css`:

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | `--duration-fast` 120ms | `--ease-signature` | Button and row hover |
| Standard | `--duration-base` 150ms | `--ease-signature` | Sort and filter transitions |
| Emphasis | `--duration-slow` 500ms | `--ease-signature` | Drag/drop settle |

Animate color, opacity, and transform. Avoid layout animation unless a shared
library already owns the interaction, and give every interactive control a
visible hover and focus affordance.

## Core Surfaces

### Issues Workspace — Board / List / Timeline / Backlog

`/workspace/{vault}/issues` is one workspace with four peer renderings switched
via `?view=` and a ViewSwitcher in the page header. Every dashboard surface is
vault-scoped under `/workspace/{vault}/…` (REEF-315): a malformed vault segment
404s, a well-formed vault the signed-in user cannot access shows an explicit
access-denied surface (with their own workspaces to switch to), and old flat
links (`/issues`, `/settings/…`) redirect through the `(legacy)` shim to the
remembered workspace's equivalent path. Board, List, and Timeline render the active
workflow collection; Backlog is a dedicated triage lens over the `backlog`
status. They share one route, one header, one Zustand filter scope, and one
filter toolbar, with the backlog view hiding facets that are pinned or
irrelevant there.

The workspace roots follow the same URL-first contract (REEF-424).
`/workspace` is the only workspace route that consults the remembered Dexie
default: it opens that vault's Issues surface or sends a signed-in browser with
no default to onboarding. `/workspace/{vault}` keeps the explicit vault,
preserves all query values, and redirects to that vault's `/issues` surface.
Malformed, inaccessible, and Reef-unconfigured vault roots never fall back to a
different remembered vault or overwrite the browser default.

**Kanban Board.** The board presents its issue collection as buckets by Status,
Priority, Assignee, Sprint, or Label; Status uses the five workflow columns
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

**List.** A dense, sortable table rendering the same issues with their field
leaves. It defaults to no grouping, and can group by None, Status, Priority,
Assignee, Sprint, or Label. Each populated bucket has a sticky, keyboard-focusable
header with a localized label, count, and `aria-expanded` collapse control;
collapsed rows leave the virtual item count and header count intact while their
DOM rows are removed. Multi-label issues occur once under each distinct label,
but selection and mutation still use the issue id. Group headers and rows share
the existing TanStack Virtual projection, cursor loading, bounded DOM,
selection, focus, quick-edit, sticky-column, and anchor-preservation behavior.
Grouping is UI-local: it is not stored in Dexie or akb, while the group choice
itself remains in the URL for sharing and navigation. Timeline and Backlog
ignore the group choice.

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

**Backlog.** A flat triage list of backlog issues with manual rank order,
drag-to-reorder when no explicit sort is active, and the shared inline quick
edit for Status, Priority, and Assignee. These field triggers keep the same
mutation, close-confirmation, cache, keyboard, and anchor behavior as List;
Labels and planning fields are not exposed in this triage lens. Empty and
no-match states are distinct: an empty backlog explains how deferred work
arrives there, while filtered-out results offer a Clear filters action.

The board shows a column-skeleton while loading, the list and backlog show row
skeletons, and timeline/settings have route-level skeletons shaped to their
content. A soft inline notice appears if some issues fail to load (cached data
is still shown). An unconfigured workspace shows a "Configure a workspace in
Settings" empty state.

**Filter toolbar menus.** Display is a compact checkable menu with independent
Show archived and Show completed toggles; it stays open while the PM changes
multiple options and hides the completed toggle in Backlog. My filters keeps
filter selection separate from management actions: update, rename, duplicate,
and delete are direct keyboard-navigable menu items grouped under each saved
filter, while loading failures, unavailable filters, active/changed state, and
empty state remain visible in the main menu. Saved names truncate in constrained
layouts but retain their full value in a title or accessible label.

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

The Inbox list is independent from the AI Suggestions queue. Each row shows
the event type, actor, related issue, occurred time, and read state. Opening a
row marks an unread notification read before navigating to the issue Activity
section when that issue is available. Mark unread and Archive are server
state transitions; the browser does not persist notification data or a
last-visit marker. Empty, loading, and fetch-failure states remain distinct.

### Suggestions Review Queue

`/workspace/{vault}/suggestions` is the PM's single review queue for proposals
detected by the agent. A background scan of the configured monitored
repositories (auto-triggered from the shell and manually refreshable here)
feeds the existing akb suggestion storage. The sidebar badge is the total
number of `pending` suggestions, independent of page visits or future
notification unread state. It remains visible on the active route, uses a
numbered pill in the expanded sidebar and an equivalently named dot in the
collapsed rail, and decreases only when a review action changes queue state.

`/workspace/{vault}/activity` remains a replace-style compatibility redirect to
Suggestions and preserves single, repeated, and empty query values. The legacy
flat `/activity` route still resolves the remembered, accessible workspace
before following the same redirect. The issue-detail **Activity** timeline is a
separate immutable audit surface and keeps its name and behavior.

The feed is a list of purple-tinted AI cards in two variants, each
human-in-the-loop:

- **AI Draft** — a proposed new issue. The card shows the title, a confidence
  reading, and a compact metadata preview, with **Approve / Edit / Dismiss**.
  Edit expands the full draft form (the same field controls as creation) so
  the PM can adjust before approving; approving creates the real issue and
  navigates to it.
- **AI Status Change** — a proposed status movement for an existing issue. The
  card shows the from→to transition, the agent's rationale, a confidence
  reading, and the count of commits/PRs that evidence it, with **Approve /
  Edit / Dismiss**. Edit lets the PM pick a different target status (Closed is
  excluded — closing needs a reason and stays in the close dialog).

When the PM returns after an absence with new items waiting, a brand-tinted
**"New since your last review"** summary card can still orient them without
changing the pending badge. Type filters (All / Draft issues / Status Changes)
sit above the queue. Each purple card carries a text AI provenance badge, so
the source is not conveyed by color alone or promoted into the page title.
Dismissed and approved suggestions persist as akb suggestion state so they
don't reappear for the workspace.

Suggestions empty states distinguish the cause while keeping recovery controls
in the surrounding composition. With no monitored repository and no pending
items, the section frame explains that repository setup is needed; the existing
Settings navigation remains outside the frame and the separate Check now
control is disabled. With a monitored repository but no pending items, the
framed state is passive: it says **"No suggestions to review"** and keeps the
existing Check now control outside the frame. If pending items exist but the
active type filter excludes all of them, the frame says **"No matching
suggestions"** and one standard outline **Clear filters** control sits below
the frame. Clearing the filter restores the pending cards from the same loaded
queue. Existing pending cards remain visible even if a monitored repository is
later removed, and the scanning-off state continues to hide Check now.

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

reef is gated by an AKB account. In local mode, `/login` presents `LoginForm`,
posts to `/api/auth/akb/login`, and keeps AKB's JWT in the
`__reef_session` httpOnly cookie. In SSO mode, the page renders AKB's enabled
provider catalog (or directly enters the sole provider), then Reef completes
OIDC Authorization Code + PKCE. The same cookie contains only a random opaque
handle; OIDC tokens never enter browser JavaScript, storage, URLs, bodies, or
cookies. After either mode succeeds, the previous account's workspace-scoped
browser state is reconciled away. There is no GitHub-OAuth sign-in, popup, or
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
SSO sign-out also deletes Reef's server session and best-effort revokes the
refresh token before navigating through the configured Keycloak logout route.

### Planning, Reports, Settings

The remaining nav destinations are first-class pages: **My Work** (the signed-in
user's overdue and due-soon work), **Planning** (sprints, milestones, releases
that issues link to), **Reports**, and **Settings**. Settings separates
per-user preferences from team-shared workspace settings such as project prefix,
monitored repos, templates, and authoring language. These pages share the
standard page header + body chrome and the same field leaves where issue fields
appear.

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

### Journey 2 — Morning Suggestions Review

1. The PM returns and sees the **Suggestions** nav item carrying the total
   pending count.
2. They open `/workspace/{vault}/suggestions`. The queue title says
   "Suggestions to review"; visiting does not change the pending count.
3. They scan the purple cards. For each **AI Status Change**, the from→to
   transition, rationale, and evidence count tell them why the agent thinks the
   work moved; for each **AI Draft**, the title, preview, and confidence tell
   them what the agent caught that they'd have missed.
4. They **Approve** (the change lands on akb and the board/list refresh; or the
   draft becomes a real issue), **Edit** (adjust target status, or open the
   full draft form), or **Dismiss** (it's gone and won't return).

Every item is a proposal with its evidence attached — nothing changed the board
without the PM's review.

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
- **AI surfaces.** `EnrichmentReviewBar` (the purple strip with loading/empty/
  error/progress states), `FieldSuggestion` (the inline per-field review card),
  `ConfidenceBadge`, `TextDiff` (word/line diffs), the Suggestions
  `ActivityFeed`
  / `ActivityItemCard` / `UnreviewedSummaryCard`, and the Ask AI
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
  per-field review cards; the Suggestions queue shows purple proposal cards
  with text provenance;
  confidence is always visible.
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
| Board / Suggestions: filtered no-match | Recovery | Existing outline control outside the section frame | Active filters produce no matches; Suggestions uses Clear filters |
| Inbox: normal empty | Passive | No CTA | There is no notification to review |
| Workspace navigation | Navigation | Existing sidebar Issues link and Issues view switcher | All My Work states; navigation is not duplicated in an empty frame |

The My Work passive states keep their title, description, and personal scope
copy. Removing the duplicate Board action does not change the existing Issues
or Board navigation, and keyboard focus follows the remaining visual order.

### Empty & Loading States

Loading uses TanStack Query's `isPending` with shadcn `<Skeleton>` placeholders
shaped like the content they replace (column skeletons on the board, table rows
for list/backlog, a structured skeleton in the detail panel, settings group
skeletons, row skeletons in the Suggestions queue), plus a slow shimmer. The **AI
enrichment loading state is purple-tinted** — the
`EnrichmentReviewBar`'s "Analyzing fields…" strip uses the `--ai-subtle`
surface with a spinning indicator, matching the purple of the suggestions it
precedes — so AI work is visually distinct from neutral content loading.

Empty states explain the state and offer a next step where one exists: an
unconfigured workspace points to Settings; an empty Suggestions queue says
there's nothing to review; an enrichment that returns nothing says "No
additional suggestions." Passive states still provide their explanation, so a
screen is never left blank.

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
| Suggestions unconfigured / passive / filtered | Named region; Settings, Check now, and Clear filters remain outside the frame | Korean wrapping, focus order, and no document-level horizontal scroll |
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
