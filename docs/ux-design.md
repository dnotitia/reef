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
in the browser; there is no desktop build, no native packaging, no offline
mode, and no cross-platform responsive obligation beyond ordinary desktop
window sizes. The product is a stateless BFF in front of the akb backend —
the server persists nothing that belongs to a user, so the entire experience
is shaped around a strict state-owner split:

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

The same human-in-the-loop pattern governs the second AI surface: the
**Activity Hub**, where the agent's autonomously detected proposals —
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

Both modes are first-class. The `.dark` class on `<html>` is set synchronously
by a no-flash boot script that honors the stored light/dark/system preference,
consulting `prefers-color-scheme` for "system" at boot and on OS changes. Every
semantic token has a dark variant.

### Typography

The product font is **Inter** (loaded via `next/font`, with a separate
display instance for headings/brand); code, IDs, and timestamps use **Geist
Mono**. Issue IDs and SHAs render in the monospace stack with tabular numerals.

### Spacing, Layout & Density

Layout follows Tailwind's spacing scale. The frame is a fixed sidebar plus a
fluid main column:

- **Sidebar** — collapsible between an expanded `w-60` and a `w-14` icon rail.
  It holds the reef wordmark, a prominent New Issue button, the primary nav
  (Issues / My Work / Planning / Activity / Reports / Settings), a footer
  utility row for keyboard shortcuts, and the workspace/account identity block.
  App-version context lives in the account menu as a release-notes link.
- **Main column** — a per-page header and the page body. The Issues page body
  swaps between Board, List, Timeline, and Backlog.
- **Issue detail** — a right-side slide-over Sheet (`min(94vw, 1200px)`),
  internally a two-column layout: title, description, Sub-issues, linked
  documents, refs, and activity timeline on the left; a 400px
  Details/People/Planning/Parent/Relations property rail on the right. Relation
  targets render as compact issue rows rather than pill chips.
- **Ask AI** — a floating non-modal panel (≈420×560) anchored bottom-right,
  above its FAB.

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
on the card. The Kanban card is reachable and openable by keyboard; pointer
drag-and-drop is the enhancement, not the only path to moving an issue (status
can also be changed from the detail panel's status select).

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

**Kanban Board.** Five columns, one per status (Open, In Progress, In Review,
Done, Closed), populated by drag-and-drop (`@dnd-kit`). A short drag distance
distinguishes a drag from a click, so a click opens the issue's detail
slide-over and a drag moves it. Dropping onto **Closed** opens a close-reason
dialog (closing requires a reason); other moves commit immediately. Each card
shows a status glyph, the monospace ID, a type pill, an optional "Blocked"
badge, the title (two-line clamp), and a compact meta row (priority dot +
label, assignee, start/due dates, sprint/release chips). Blocked state is
computed from the dependency graph projected over the whole vault, so badges
stay correct even when the board view is filtered.

**List.** A dense, sortable table rendering the same issues with their field
leaves.

**Timeline.** A date-windowed schedule view of the same set.

**Backlog.** A flat triage list of backlog issues with manual rank order,
drag-to-reorder when no explicit sort is active, and an inline status picker to
promote work out of the backlog. Empty and no-match states are distinct: an
empty backlog explains how deferred work arrives there, while filtered-out
results offer a Clear filters action.

The board shows a column-skeleton while loading, the list and backlog show row
skeletons, and timeline/settings have route-level skeletons shaped to their
content. A soft inline notice appears if some issues fail to load (cached data
is still shown). An unconfigured workspace shows a "Configure a workspace in
Settings" empty state.

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
type name kept for screen readers.

### Activity Hub

`/activity` is the PM's review queue for everything the agent detected. A
background scan of the configured monitored repo (auto-triggered from the
shell, and manually refreshable here) feeds an akb activity inbox; the sidebar
shows an unread badge until the PM visits, at which point the feed records the
visit and clears it.

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
**"Since you were last here"** summary card leads the feed with the counts,
dismissible with "Got it". Type filters (All / AI Drafts / Status Changes)
sit above the feed. Dismissed and approved suggestions persist as akb activity
suggestion state so they don't reappear for the workspace. The empty state reads
"No AI drafts or status changes to review."

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

reef is gated by an akb account. `/login` is a username/password form
(`LoginForm`) that posts to `/api/auth/akb/login`; on success the akb session
lives in the `__reef_session` httpOnly cookie (never mirrored into the
browser's own storage), the previous account's workspace-scoped browser state
is reconciled away, and the user enters the app. There is no GitHub-OAuth
sign-in, no popup, and no management-repository selection.

First-time users hit an **OnboardingGuard** that redirects to `/onboarding`
until setup is complete. Onboarding is a single screen whose required step is
**Create a project workspace**: name a new akb vault (lowercase/digits/
hyphens), choose an issue **prefix** (uppercase, e.g. `REEF`), optionally add a
description and monitored repositories, and create. A secondary, collapsed path
lets the user pick an existing reef workspace instead. Monitored repository
access comes from deployment-managed GitHub credentials, so onboarding
configures a *workspace*, not a Git repo, and no issue is committed under
anyone's GitHub identity.

### Planning, Reports, Settings

The remaining nav destinations are first-class pages: **My Work** (the signed-in
user's overdue and due-soon work), **Planning** (sprints, milestones, releases
that issues link to), **Reports**, and **Settings**. Settings separates
per-user preferences from team-shared workspace settings such as project prefix,
monitored repos, templates, and authoring language. These pages share the
standard page header + body chrome and the same field leaves where issue fields
appear.

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

### Journey 2 — Morning Review at the Activity Hub

1. The PM returns and sees the **Activity** nav item carrying an unread badge.
2. They open `/activity`. A "Since you were last here" summary leads with the
   counts; visiting clears the unread badge.
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
  `ConfidenceBadge`, `TextDiff` (word/line diffs), the Activity `ActivityFeed`
  / `ActivityItemCard` / `UnreviewedSummaryCard`, and the Ask AI
  `AskAiFab` / `AskAiDialog` / `ChatSurface`.
- **Shell.** `DashboardShell` (sidebar, nav, account/release context, global
  dialogs), page header/body, the global search palette, the keyboard-shortcuts
  sheet, and the offline banner.

The AI components share the `--ai` token family so that AI work reads as a
consistent purple track wherever it appears, distinct from the teal brand.

## UX Consistency Patterns

### Feedback

Three feedback sources are treated distinctly:

- **Human actions** — successful saves/creates use Sonner toasts; routine
  inline edits in the detail panel are silent except for the header Saving…/
  Saved indicator; filters/sorts re-render silently.
- **AI actions** — always purple. Enrichment shows a loading strip, then
  per-field review cards; the Activity feed shows purple proposal cards;
  confidence is always visible.
- **System errors** — translated to PM vocabulary, shown inline with
  `role="alert"` or as a toast, never as Git or raw backend errors.

The button hierarchy is consistent: one primary action per context (e.g.
Create issue, Approve); AI confirmations use the purple `bg-ai` button (Apply,
Apply all, Approve a draft); supporting actions are ghost/outline; destructive
actions (Delete) are red and confirmed.

### Empty & Loading States

Loading uses TanStack Query's `isPending` with shadcn `<Skeleton>` placeholders
shaped like the content they replace (column skeletons on the board, table rows
for list/backlog, a structured skeleton in the detail panel, settings group
skeletons, row skeletons in the activity feed), plus a slow shimmer. The **AI
enrichment loading state is purple-tinted** — the
`EnrichmentReviewBar`'s "Analyzing fields…" strip uses the `--ai-subtle`
surface with a spinning indicator, matching the purple of the suggestions it
precedes — so AI work is visually distinct from neutral content loading.

Empty states explain and offer a next step: an unconfigured workspace points to
Settings; an empty activity feed says there's nothing to review; an
enrichment that returns nothing says "No additional suggestions." A screen is
never left blank.

### Error Handling

Errors follow "what happened + what you can do." Network and load failures
offer Retry; enrichment failures show a PM-vocabulary message with **Try
again** and never block creating the issue without AI; the rare save conflict
is surfaced as a save conflict, not a merge conflict. AI degradation is
silent and total — when the deployment lacks AI, the affordances vanish and the
core product is unaffected.

### Keyboard Shortcuts

Global shortcuts are registered at the shell: **⌘N** opens New Issue, **⌘K**
toggles global search, **⌘⇧A** toggles Ask AI, **⌘?** opens the
keyboard-shortcuts sheet, and **Esc** closes the active panel. Text-field focus
is respected so typing is never hijacked.
