# Changelog

All notable product changes to reef are recorded here.

This project follows a single product-version policy for the deployed reef-web
application. The repository is still in the `0.x` series, so breaking user,
storage, or operational changes are released as minor versions and called out
explicitly in the entries below.

> `REEF-XXX` ids in these entries reference Dnotitia's internal issue tracker and
> do not resolve as public GitHub issues.

## Unreleased

### Added

- **Manage who's in a workspace, right from Settings.** The Workspace → Members
  tab now lists everyone with access to the active workspace alongside their
  role. Admins and owners can add an existing akb user by searching the user
  directory and picking a role, change a member's role inline, or remove a
  member — the owner can't be removed, and you can't remove yourself. Writers and
  readers see the roster read-only. There is no email invite: akb has no
  invitation flow, so this grants access to people who already have an akb
  account rather than sending an invitation (REEF-179).

### Changed

- **Faster first load — the rich-text editor now loads on demand.** The markdown
  editor and its formatting engine (TipTap/ProseMirror) are no longer part of the
  initial app bundle; they load the first time you open a surface that edits text
  (creating an issue, editing an issue's description, the planning editor, or a
  settings template). A height-matched placeholder holds the editor's space while
  that happens, so the form doesn't jump. Behavior is unchanged once the editor is
  open (REEF-220).
- **Clearer GitHub token setup — which scopes, and where to create one.**
  Onboarding and Settings → Preferences now show the same guidance wherever you
  paste a monitored-repo Personal Access Token: it is read-only access, use
  `public_repo` for public repos or `repo` for private ones, and a "Create a
  token" link opens GitHub's token page with the scope preset. The guidance
  stays visible even when a token is already saved — so re-issuing one after
  changing GitHub accounts is no longer guesswork — and the Monitored Repos
  "Preferences tab" pointer is now an actual link (REEF-236).
- **Backend logs are now structured via pino, and pretty in development.**
  Server-side request and error logs are emitted as one JSON line per event in
  production and as human-readable colorized output when running locally.
  Credential-bearing headers (`Authorization`, `X-Reef-LLM`, `Cookie`,
  `Set-Cookie`, `Proxy-Authorization`) are redacted at the logger, and logs
  emitted inside a request trace now carry the `trace_id`/`span_id` so they line
  up with the OpenTelemetry spans for that request (REEF-235).
- **Settings is now organized into scope-based tabs.** The single long scroll is
  split into **Workspace**, **Preferences**, and **Deployment** tabs, each its
  own page — so back/forward, open-in-new-tab, deep-link, and bookmark all work,
  and adding settings no longer lengthens one screen. The Active Workspace
  selector lives on the Workspace tab only (it doesn't apply to the
  browser-local Preferences or operator-managed Deployment), and the Workspace
  tab itself has **General** and **Members** sub-views governed by that one
  selector — switching workspace re-scopes both together. Existing settings moved
  to their matching tab with nothing dropped; the member list arrives later
  (REEF-183).
- **The Reports dashboard no longer double-encodes priority and age.** The
  priority × last-update **Risk map** is now the single home for both axes, so
  the standalone one-dimensional **By priority** and **Aging** cards it already
  contained as its row and column totals have been removed. The Risk map is also
  labelled as covering open work, so its counts can't be mistaken for the
  in-scope total (REEF-184).
- **Global search (⌘K) results are now real links.** Each result row links
  directly to the issue, so Cmd/Ctrl-click, middle-click, and right-click → "Open
  in new tab" all work as expected; keyboard selection is unchanged. The palette
  also reads better with assistive technology — the search box has an explicit
  label, status changes ("Searching…", "No matching issues.") are announced, and
  the results list no longer scroll-chains the page behind it. The duplicate
  close ✕ that overlapped the search box is gone (Esc still closes), and issue
  ids are no longer altered by browser auto-translation (REEF-221).

### Fixed

- Opening an issue from the **List**, **Timeline**, or **Backlog** tab no longer
  flips the background to the Board. Clicking an issue now keeps the tab (and any
  active filters/sort) you were on while the detail sheet slides over, and
  closing it returns you to that same tab. Typing or refreshing a
  `/issues/REEF-XXX` deep link still opens over the Board as before (REEF-222).
- The built-in workspace agent playbook now guards three issue-creation
  pitfalls so an agent following it can no longer leave a malformed or
  invisible issue: it surfaces the parent link so an issue filed under an epic
  is attached rather than orphaned, requires a fully-formed timestamp on status
  changes so a status edit can't silently drop the issue off the board, and
  explains how to spot and repair a saved issue that a malformed field is
  hiding. Existing workspaces are offered the updated playbook from Settings
  (REEF-224).
- **Focus outlines on form fields are no longer shaved off on the left and
  right.** When you focused a field inside a column that hides horizontal
  overflow — most visibly the Title field on the issue edit screen — the teal
  focus border was clipped on its left and right edges while the top and bottom
  stayed intact. The border now shows on all four sides, and long content is
  still kept from widening the column. Focus rings across the edit, settings,
  sidebar, and activity surfaces also behave consistently now: they appear on
  keyboard focus only (no flash on a mouse click) and share one color and weight
  (REEF-226).
- **The sidebar footer workspace and account triggers now show a focus ring for
  keyboard users.** Tabbing onto either trigger previously gave no visible
  indication; both now draw the same focus-visible ring used elsewhere. The
  workspace switcher's search field also opts out of password-manager and
  spellcheck prompts and uses a proper ellipsis (…) placeholder, and menu items
  highlight on keyboard focus only (REEF-172).

## v0.4.0 - 2026-06-12

### Added

- **Workspace SSO via Keycloak, delegated through AKB.** Deployments that
  configure AKB's Keycloak callback and a reef post-login path show a workspace
  SSO action on the login page, exchange AKB one-time codes server-side into the
  normal `__reef_session` cookie, and reconcile the signed-in actor before
  routing. Password login stays available when SSO is disabled or unavailable.
  The deployment contract and the non-blocking logout/error redirect are
  documented in `docs/keycloak-sso.md` (REEF-102).
- **Your current workspace now shows in the sidebar footer**, just above your
  account — the active vault's name and a square monogram (collapsed, only the
  monogram, with the name in a tooltip). Clicking it opens an upward switcher
  that lists your reef workspaces with a search box, marks the current one, and
  switches in a single click. A pinned **New workspace** entry (always present,
  even before you have any) opens a create dialog that uses the same form as the
  onboarding screen; the same dialog is also reachable from a **New workspace**
  button in Settings next to the workspace switcher (REEF-146, REEF-147).
- Issues now have an explicit **Backlog** stage, separate from **Todo**. A new
  **Backlog** view — alongside Board, List, and Timeline — collects backlog
  issues in a focused triage list with an inline status picker, so you can
  promote one to Todo in place. Backlog issues stay off the active board, the
  timeline, and the default landing view and don't count toward in-flight health
  metrics, but they still appear in the overall status breakdown and can be
  filtered and set like any other status (REEF-109).
- The issue detail now shows a **Sub-issues** section listing an issue's
  children with a done-of-total progress summary, so opening an epic or parent
  surfaces its child work. Resolved children sink to the bottom dimmed, and the
  section is hidden when there are none (REEF-081).
- A shared **sort control** in the issues header now drives both the board and
  the list, so the two always order the same way — the Kanban board can finally
  be sorted, within each status column. Two new sort options join the existing
  Priority / Due date / Start date / Updated / Created set: **Points** and
  **Title** (A→Z, locale-aware so Korean titles read naturally). The direction
  reads as intent ("High → Low", "Soonest", "A → Z"), and the default stays
  Priority high→low until you pick one (REEF-059).
- The board and list now **animate state changes**: cards and rows glide into
  their new positions when status, filter, or sort changes instead of blinking
  out and back, a dragged card eases into its dropped slot, and the card whose
  edit just saved gives a brief brand-colored pulse to confirm it landed — all
  honoring your reduced-motion setting (REEF-121).
- You can now link akb workspace documents to an issue. A new **Linked
  documents** section lets you search the vault by title and attach a document
  as a first-class reference shown as a document card, with a one-click open in
  akb, a copy action, and remove. When drafting a new issue, **Enrich with AI**
  can also suggest supporting documents to cite. The old free-text "Document"
  external-reference type is retired in favor of this; existing document entries
  keep working and read as plain references (REEF-083).
- Issue **Start** and **Due** date fields now use an in-app calendar that
  matches reef's look and supports dark mode, replacing the browser-native date
  popup. A one-click **Today** action (computed from your local calendar, so it
  never lands on tomorrow around midnight) and a **Clear** action are built in,
  and typing or pasting a `YYYY-MM-DD` date still works. The picker appears
  everywhere dates are edited — issue detail, the new-issue dialog, and AI draft
  metadata (REEF-108).
- The issue Description editor toolbar now exposes the common markdown controls
  directly — strikethrough, inline code, Heading 3, numbered lists, block
  quotes, a horizontal divider, and an inline link insert/edit field — grouped
  with hairline dividers, uniformly sized, showing their active state, and
  wrapping cleanly in narrow dialogs. Because it is the shared editor, the change
  applies to the new-issue dialog, issue detail, AI draft review, and planning
  notes (REEF-082).
- The sidebar account menu now has a **theme quick switch** (Light, Dark, or
  System) that stays in sync with the Settings → Appearance control; picking a
  theme applies it immediately and leaves the menu open so you can compare
  (REEF-095).
- Workspaces can now set a **default authoring language** for AI-generated
  content. In Settings → Workspace, a member with write access picks the language
  reef's AI writes new issue drafts, enrichment suggestions, and status
  rationales in, so the team's generated content reads consistently no matter who
  produced it; the default also reaches agents that operate the workspace
  directly. Leave it unset to keep the prior per-request behavior; it affects only
  newly generated prose and never rewrites existing issues or your own wording
  (REEF-136). You can also pick this language **while creating a workspace** — the
  create form, on both the onboarding screen and the sidebar New workspace
  dialog, has an optional language picker (REEF-160).
- Settings now shows a **Workspace AI Instructions** status: whether this
  workspace's AI playbooks are current with the running release and, when they
  are not, a one-click update. (The instructions are installed once at workspace
  creation and were never re-synced, so a release that improved them left
  existing workspaces on the older version with no way to tell.) Applying it
  confirms first that it replaces the workspace instructions for everyone and
  overwrites manual edits; members without edit access see the status but not the
  action (REEF-123).
- A workspace **account menu** now sits at the bottom of the sidebar, always
  visible whether or not GitHub is configured. It shows who you're signed in as
  and a **Sign out** that ends your akb session independently of GitHub; signing
  out also clears this browser's akb-scoped cache and per-account view state
  (active vault, saved filters, activity markers) so the next person on a shared
  machine can't inherit it, while preserving your GitHub token and theme. It also
  carries a "Keyboard shortcuts" launcher (⌘?) and the app version (REEF-068).

### Changed

- **New issues now land in Backlog by default** — both the create form and AI
  activity-scan drafts — instead of going straight to the active board; AI drafts
  pick their status from code signals where available (REEF-130).
- **You can now reorder the backlog while a filter is active.** Every backlog
  issue now carries a manual-order position (new issues, and issues sent back to
  the backlog, append to the bottom), and a filtered drag is placed against the
  issue's true neighbors in the full backlog order — not just the rows on screen.
  The grip stays available under a filter; picking an explicit sort still turns
  manual reordering off, as before (REEF-176).
- **The backlog filter bar now shows only the filters that make sense there.**
  Sprint, Release, and Due facets are hidden in the backlog (joining Status,
  which the view already pins) — they either return nothing or contradict the
  view — leaving Type, Priority, Severity, Dependency, Assignee, Requester,
  Labels, and Milestone. A stray Sprint/Release/Due value set in another view no
  longer silently filters the backlog or blocks drag-to-reorder (REEF-177).
- **Issue sorting is now driven from one header control across Board, List, and
  Backlog.** Manual order is a first-class backlog sort choice, the list column
  headers are now plain labels (no longer a competing sort entry that could
  disagree with the control), and the duplicate in-body sort line and the
  "Backlog · N issues" count are gone — the body carries only the
  drag-to-reorder affordance (REEF-169, REEF-175).
- The multi-select filter dropdowns (Status, Type, Priority, Severity, Due,
  Dependency) now share the same **combobox styling** as the rest of reef —
  consistent option rows, a trailing brand checkmark, and a chevron that rotates
  on open (REEF-140).
- The issue filter bar's **Labels** field now matches the create and edit
  screens: type a label and press Enter to add it as a chip, instead of typing a
  comma-separated string (REEF-091).
- **Mutation feedback is now split by the kind of action** instead of one generic
  toast: a failed background save (a board move or auto-save) shows a retryable
  error toast that retries in place, archiving an issue offers a one-click undo,
  and new-issue form errors appear inline with focus on the first problem
  (REEF-119).
- **Settings is organized into three ownership groups** — **Workspace**
  (team-shared), **Your preferences** (browser-local), and **Deployment**
  (operator-managed) — and team-shared workspace settings respect your vault
  role: members with write access edit them, while read-only members see them
  (including a view-only template editor) without edit or save controls
  (REEF-020).
- Settings now makes clear **which workspace its shared settings apply to**: the
  Active Workspace selector reads as the scope it is (its heading carries the
  group's weight, it sits directly above the Workspace settings it scopes, set
  apart from your personal and deployment settings), and the Workspace settings
  header names the active workspace — plus minor accessibility fixes (save
  confirmation announced, keyboard-only focus ring, decorative status dot hidden)
  (REEF-174).
- **Your own avatar is now teal everywhere.** The brand tint that marked the
  signed-in user only in the sidebar now marks you on every people surface (board
  cards, list and backlog rows, the assignee picker), keyed by the same akb login
  the issue rows use, so your color and monogram line up with how you appear as an
  assignee. Everyone else keeps their distinct hashed color (REEF-173).
- **Ask AI no longer requires a GitHub connection.** With no GitHub token
  configured, the assistant grounds answers on your akb workspace alone (issues
  and assignees) and skips monitored-repo code search instead of failing the
  request; connect GitHub to add code grounding back (REEF-089).
- The Planning create and edit dialogs now follow the same pattern as the issue
  dialogs: the date fields use the in-app calendar picker instead of the
  browser-native popup, and the dialog sizing and close control line up with the
  rest of the app (REEF-154).
- The Reports scope bar now uses the same sprint, milestone, release, assignee,
  and label controls as the issues board (pickers showing the planning item's
  name, a member typeahead, labels as chips), so a label or assignee scope
  narrows a report exactly the way the same filter narrows the board. Period and
  scope (active / all / completed) remain specific to reports (REEF-074).
- The issues timeline (`/issues?view=timeline`) now opens scrolled to today,
  anchored within the visible viewport on the roughly 2,300px-wide quarter grid.
  The Today button re-centers on today within the current quarter, edge fade
  shadows signal that the grid scrolls horizontally, and a "Today" chevron
  appears at whichever edge today lies beyond; the sticky month/day header and
  label column stay put, and the smooth re-centering respects
  `prefers-reduced-motion` (REEF-078).
- The ⌘K global search palette now searches **every issue** in the workspace
  through the same server-side search the issues list uses, instead of only the
  issues already loaded. Typing matches by id, title, assignee, requester,
  reporter, milestone, sprint, release, or label; archived issues are excluded
  and an empty box previews recent issues — at the cost of a brief server
  round-trip instead of an instant cache lookup (REEF-080).
- `/api/repos` now uses the same GitHub error translation policy as the rest of
  the web API instead of its hand-written Octokit ladder. GitHub 403s now pass
  through as `403` instead of being collapsed to `502`, other upstream failures
  use the generic GitHub message without the old numeric suffix, and 304 cache
  revalidation still returns a no-body `304` with the ETag preserved (REEF-076).
- The issue detail panel no longer shows the akb "Provenance" section — the
  document's latest commit hash and a second copy of its related-issue links
  (already shown and editable in Relationships). The one piece worth keeping,
  when the issue was last edited, now appears in the detail header as a relative
  "Edited …" timestamp (hover for the exact time) (REEF-122).
- Old bookmarks and shared issue links that still carry the pre-rename
  `status=open` filter value no longer fall back to the renamed **Todo** status.
  The temporary compatibility mapping added alongside the Open→Todo rename has
  been retired now that all stored issues use the new value; such a stale link
  ignores just that one filter, and re-saving it from the current filters
  restores it (REEF-141).

### Fixed

- Checklist markdown in an issue description now works: `- [ ]` and `- [x]`
  items render as checkboxes inline with their text, instead of throwing a
  runtime error or dropping the checkbox onto its own line above the item
  (REEF-157, REEF-161, REEF-164).
- The issue Description editor no longer grows without bound as you type — long
  content scrolls inside a height-capped editor instead of stretching the
  slide-over or dialog — and its Source view auto-grows with the content instead
  of staying stuck small (REEF-133).
- Opening the Milestone (or another) dropdown while editing an issue no longer
  scrolls the slide-over and pushes its content around; the panel scrolls within
  its own list and flips to stay on screen instead of clipping (REEF-145).
- The issue filter dropdowns are tidied: re-clicking an open trigger now closes
  it instead of momentarily closing and immediately reopening (REEF-073), long
  Assignee/Requester names and their @login no longer truncate in the open panel
  (REEF-134), and Due/Dependency options appear as the same colored badges used
  for those values elsewhere instead of plain text (REEF-072).
- An issue's external reference URLs (commit, PR, design, and document links) now
  render as clickable links that open in a new tab instead of plain text, while
  non-URL references stay plain (REEF-087).
- In the GitHub activity-scan review cards, a draft's references — the issues it
  would link, the source GitHub activity, and its PR/commit evidence — now render
  as clickable links instead of plain text (REEF-156).
- Reports now count an issue toward **Blocked** and **At risk** only when one of
  its dependencies is still unresolved, instead of whenever it listed any
  dependency at all; issues whose blockers are already done no longer inflate
  those totals (REEF-155).
- Approving a status change suggested by a GitHub activity scan now records the
  suggestion's PR and commit evidence on the issue's Delivery (implementation)
  refs, instead of applying only the new status and leaving Delivery empty;
  re-approving or re-scanning never duplicates a ref (REEF-138).
- In the new-issue dialog and the issue detail sheet, the close (X) control no
  longer overlaps the header actions: the dialog drops its redundant X (Cancel,
  Esc, and clicking outside still close it), and the sheet moves close into the
  header beside its actions menu (REEF-111).
- In the new-issue dialog, clicking a relationship suggestion (Parent / Depends
  on / Blocks / Related to) now adds it instead of just closing the dropdown; the
  suggestion list was inheriting the dialog's click-blocking, so mouse picks were
  swallowed (REEF-092).
- Editing an issue no longer leaves its body and its board fields out of sync
  when a save partially fails: if the row update fails after the document was
  already written, reef rolls the document back so the two stores stay consistent
  (REEF-094).
- The issue editor and the new-issue dialog now share a wider layout whose right
  rail lays each field out as a full-width row (label on the left, value taking
  the rest) instead of cramped two-up cells, so Start/Due dates, Sprint /
  Milestone / Release names, and Relationship ids no longer clip and the create
  and edit screens read identically (REEF-149, REEF-167).
- Long delivery activity and external reference values (branch names, commit
  SHAs, PR titles, URLs) no longer spill out of the issue detail editor into the
  right-hand Details / People / Planning rail: each row truncates within its
  column, exposes the full value on hover, and adds a copy button so the
  untruncated value stays reachable (REEF-071).
- On the issue board, a card's assignee avatar now sits in a fixed slot at the
  right edge of every card, so avatars line up vertically as you scan down a
  column instead of drifting with whether the card shows a priority (REEF-128).
- The Settings workspace picker now lists only akb vaults that already have a
  reef config, matching the onboarding picker, so you can no longer select a
  workspace reef can't read issues in and land on an empty board with no way to
  initialize it (REEF-143).
- Workspaces that haven't connected GitHub no longer pile up repeated
  "authentication required" errors: reef treats "no GitHub token" as a normal
  state, skipping the repository listing and the activity scan and showing a
  "connect GitHub first" hint; saving a token resumes those features with no
  refresh, and an invalid or expired token surfaces a single error instead of
  retrying (REEF-159).
- The two identity rows and the two pop-up menus at the bottom of the sidebar —
  your workspace and your account — now line up and behave consistently: the rows
  share one layout (the switch arrow stays put through loading, no stray accent
  bar, both keep a second line), and both menus share the same width within the
  sidebar, close on Escape, and respect reduced motion (REEF-168, REEF-171).
- The Planning screen received the same accessibility and shareable-state pass as
  the issue surfaces: its sections and dialogs announce their structure, the open
  planning view is reflected in the URL so it can be shared and restored on
  reload, and dates render through the shared themed display (REEF-152).
- Settings is cleaner and more accessible: each setting nests as a proper
  sub-heading under its group, the project-prefix and search fields announce their
  labels to screen readers, decorative icons are hidden from them, ellipses use a
  real character, and saving a GitHub token disables the button and shows a
  spinner while it's in flight (REEF-151).

### Migration

- **Issue status `open` was renamed to `todo`.** The temporary read-side
  compatibility shim shipped (REEF-139) and was then removed within this same
  release (REEF-141), so it is no longer present. Each existing workspace must run
  a one-time backfill at or before deploy — `UPDATE reef_issues SET status='todo'
  WHERE status='open'` per vault — or any issue still stored as `open` drops out
  of the active board/list view. New writes already use `todo` (REEF-139,
  REEF-141).
- **Planning tables now let akb own their `id` primary key.** Existing vaults
  whose `reef_sprints` / `reef_milestones` / `reef_releases` predate this (e.g.
  `reef-test`) must run `docs/migrations/REEF-158-planning-uuid-id.sql` once per
  vault: back up the affected tables, run the script (a single transaction),
  confirm the verification query returns 0, then deploy the new build. It swaps
  the old text logical id (`spr-`/`mil-`/`rel-`) for akb's uuid and remaps
  `reef_issues.{sprint,milestone,release}_id` plus any pending
  activity-suggestion `meta`. Newly created vaults are uuid-native and need no
  migration (REEF-158).
- **The Reef vault skill and AI runbooks were revised several times** this
  release (people / backlog / sprint runbook rules, the authoring-language
  directive, the status-rename guidance, the planning-uuid workflow) and now
  stamp skill version 9. There is still no automatic re-sync for existing
  workspaces such as `reef-test`; update each one via the new Settings →
  Workspace AI Instructions panel (REEF-123) or manually with `akb_update`
  (REEF-123, REEF-136, REEF-139, REEF-148, REEF-158, REEF-166).
- **Backlog manual-order ranks live in `reef_issues.rank`.** New and demoted
  backlog issues are now born with a tail rank, but a vault that accumulated
  backlog rows before manual ordering will have `NULL` ranks that sort to the
  bottom out of order; run a one-time `UPDATE reef_issues SET rank=0 WHERE rank IS
  NULL` per such vault (reef-test was already backfilled). New vaults are
  born-correct and need nothing (REEF-129, REEF-176).

### Operational

- Deployments that enable AKB-delegated Keycloak SSO must set `REEF_PUBLIC_ORIGIN`
  in the reef-web config to the bare https public origin matching the ingress
  host. It is the absolute SSO callback base reef-web sends to akb so the callback
  survives akb's redirect allowlist when reef runs alongside akb's own frontend;
  without it the SSO round-trip can fail. Password login is unaffected when SSO is
  disabled (REEF-102, REEF-137).
- When a vault needs the REEF-158 planning migration, sequence it with the
  rollout: run and verify the SQL first, then build/push and roll out the new
  reef-web image (planning is briefly unavailable between the migration and the
  new build going live). Vaults with no planning tables to migrate take the
  normal image rollout (REEF-158).

## v0.3.0 - 2026-06-05

### Added

- Issue search and relation dropdowns now show card-level rows — status icon,
  id, title, type pill, priority dot, and a blocked badge — instead of plain
  text, so you can identify and pick an issue at a glance the same way you read
  a board card (REEF-032). The relation fields (Parent / Depends on / Related)
  move from a native autocomplete to a keyboard-navigable combobox; typing an
  id that isn't in the list still adds it via a "Use …" row, and the ⌘K palette
  shares the identical row styling.
- Issue filters and sort are now remembered per workspace: the issue board/list
  restores your last-used filter and sort when you reload or revisit `/issues`
  (REEF-009). Filters stay browser-local (IndexedDB); a shared link with filter
  query params still takes precedence over the saved filter, and the search box
  is intentionally not restored. Saved filters are cleared when a different akb
  account signs in on the same browser.
- Issue type and bug severity now read at a glance through a shared
  glyph-and-color visual system: each issue type has its own icon and color, and
  bugs carry a severity scale (blocker / critical / major / minor / trivial)
  with matching visuals across the board, list, filters, and edit surfaces
  (REEF-026, REEF-058).
- The kanban board and list apply a default order — priority first, with issue
  number as the tiebreaker — so the most urgent work surfaces to the top without
  manual sorting (REEF-057).
- Planning items (sprints, milestones, releases) gained a markdown editor for
  their notes, matching the issue editor, so planning context can use headings,
  lists, and links instead of plain text (REEF-027).

### Changed

- Web API error responses now follow one canonical translation policy
  (REEF-054): every akb-backed Route Handler maps typed errors to the same
  status codes and PM-facing wording through core `translateError`, replacing
  the per-route ladders and the old `translateAkbError` helper. User-visible
  status changes are confined to AI enrichment, which now returns `403` for a
  forbidden workspace backend (was `401`), `422` for invalid request context
  (was `400`), and `502` for an unknown workspace-backend failure (was `503`).
  Unexpected server errors across these routes now consistently return a `500`
  with the generic message "An unexpected error occurred." instead of bubbling
  to Next.js's framework 500. (`/api/repos` keeps its bespoke GitHub error
  ladder for now; its migration is tracked as a follow-up, REEF-076.)
- The akb auth/session boundary now follows the same rule as the rest of reef:
  `core` owns every akb wire call and schema (`login`, `getMe`,
  `getCurrentActor`), and the web Route Handlers keep only the `__reef_session`
  cookie lifecycle (REEF-052). No user-visible behavior changes — login, the
  session probe, and issue-author attribution return the same responses — but the
  akb user schema that was duplicated inside `web` is removed and the boundary is
  consistent across the codebase.
- Issue list search and free-text filtering now run as backend queries against
  the workspace store instead of fetching the whole vault and filtering in the
  browser, so large issue sets stay responsive and results match the server-side
  filters (REEF-008, REEF-034).
- The AI features (issue enrichment, GitHub activity scan, workspace chat) were
  rebuilt on a shared agent framework: a typed runtime event model, an agent
  registry and factory, a unified agent API route with a streaming client and
  reducer, a common AI-review interaction UI, and an artifact-persistence and
  approval contract replace the ad hoc per-feature wiring (REEF-024 and
  REEF-036…047). No user-facing behavior change, but every AI interaction now
  shares one streaming, review, and approval path.
- Issue field dropdowns across filters, create, and edit were unified to a single
  glyph-and-color representation; the redundant issue-type option chips were
  removed and the create form now uses the same glyphs as the rest of the app
  (REEF-058, REEF-067).
- reef's brand presentation was made consistent with a new app icon, a rail
  favicon and login mark, and a sidebar brand lockup (REEF-069).
- Prototype-era client persistence paths were inventoried and removed,
  consolidating browser-persistence responsibilities ahead of the planned
  IndexedDB unification (REEF-005, REEF-006, REEF-007). No browser storage
  migration is required.
- Restructured the repository into a `packages/` layout: the `core` and `web`
  workspaces moved to `packages/core` and `packages/web`, and `mockups/` moved
  under `docs/mockups/`. Package names (`@reef/core`, `web`) and the `@/` import
  alias are unchanged, so application behavior and the deployed image are
  identical — this is a source-tree and build-config change only (pnpm workspace
  globs, tsconfig `extends`, Dockerfile paths, CI artifact paths, and the
  release-policy check were updated to match). No user, storage, or operational
  migration is required. Migration-tracked sources moved path-only with no
  content change — the vault skill/runbook installer (`vaultSkill.ts`), the
  Dexie browser-storage schema (`db.ts`), and the persisted query cache provider
  (`QueryProvider.tsx`) keep identical behavior, so no vault-skill reinstall and
  no browser cache/persist buster bump are needed.

### Fixed

- Approving an AI-drafted issue no longer echoes a raw internal error message in
  its `500` response body; failures now return a generic PM-facing message
  (REEF-054).
- The issue provenance panel no longer fails to load for issues that link to
  other issues (REEF-049). Opening provenance on a linked issue previously
  returned a server error; reef now reads the workspace backend's relation shape
  correctly and renders the linked issues. Issues without links were unaffected.
- Issue filter dropdowns (Status, Type, Priority, Severity, Due, Dependency) are
  now genuinely multi-select: the checkbox menus let you pick several values at
  once and the board/list narrows to issues matching any of them (REEF-031).
  Previously the checkbox affordance only kept a single value — picking a second
  one cleared the first. Selections round-trip through shareable URLs as repeated
  query params (`?status=open&status=in_progress`) and through the saved
  per-workspace filter. Single-value links and pre-existing saved filters from
  before this change still restore correctly — a legacy single value is widened
  to a one-element selection on read, so no saved filter is lost on upgrade.
- The sidebar navigation menu is visible again in the collapsed state: collapsed
  nav now shows icon-only entries instead of hiding the menu entirely (REEF-070).
- Done and closed issues no longer show a past due date as overdue (REEF-079).
- AI draft generation checks a wider scope of existing issues for duplicates, so
  activity scans stop proposing drafts that duplicate already-tracked issues
  (REEF-022).
- GitHub activity without an explicit issue id is now matched to the
  corresponding existing issue instead of being dropped (REEF-023).
- Approving an activity-scan status change on the runbook path now records the
  evidence pull request and commit on the issue's implementation refs (REEF-033).

### Migration

- The Reef vault skill and runbooks were updated: issue status-transition rules
  and the issue-creation template-body step are now documented, and load-bearing
  invariants were promoted into the always-loaded vault skill with their
  rationale (REEF-025, REEF-028, REEF-029). The installer (`vaultSkill.ts`) is
  idempotent on fresh installs; existing workspaces such as `reef-test` have no
  reinstall endpoint and must re-sync the vault skill document manually via
  `akb_update`.

## v0.2.0 - 2026-06-01

### Changed

- Documented the reef release policy, changelog expectations, and migration
  policy.
- Centralized the product version in the root `package.json` and set the current
  product version to `0.2.0`.
- Added a release-policy check that enforces the single version source, blocks
  ad hoc akb SQL migrations, and requires changelog coverage for migration-prone
  files.
- Wired the release-policy check into CI so migration-prone changes cannot rely
  on manual review alone.
- Allowed `CHANGELOG.md` to keep an empty `Unreleased` section after cutting a
  release while still enforcing coverage for migration-prone files.

### Migration

- Removed the committed test SQL migration file from `deploy/migrations`. Reef
  does not own direct akb database migrations in this repository; release notes
  should instead document required akb compatibility and operational migration
  steps.
