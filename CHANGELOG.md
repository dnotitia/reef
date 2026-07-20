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

- **Select and edit multiple issues together in List.** List rows now expose
  keyboard-accessible checkboxes, Shift+Click range selection, and an integrated
  toolbar for status, assignee, priority, sprint, and label changes. Board stays
  focused on drag-and-scan work; bulk editing remains available after switching
  to List.
  Updates reuse the existing single-issue save path sequentially, preserve
  successful items when one fails, and keep failed items selected for recovery.
  Selection controls use full labeled hit targets, while the bounded failure
  tray retries transient failures and removes stale not-found items cleanly.
  (REEF-339, epic REEF-330)

## v0.7.0 - 2026-07-10

### Added

- **Grounded, transparent Ask AI.** Ask AI now uses the current workspace and
  issue as context, shows tool-call progress, links cited Reef issues, and
  exposes document sources so answers can be checked against workspace data.
  (REEF-337, REEF-360, REEF-361)
- **Issue attachments and richer document links.** Issue descriptions and
  comments accept uploads from the toolbar, paste, and drag-and-drop. Images
  render inline, other files remain downloadable, and bare AKB document URIs
  become readable title links. (REEF-349, REEF-395, REEF-401)
- **Faster issue creation and triage.** The issue detail and create flows now use
  a details-first property rail, support creating multiple inherited sub-issues,
  and show advisory similar-issue matches while drafting. (REEF-352, REEF-353,
  REEF-375)
- **Keyboard-first issue navigation.** Lists and boards support roving keyboard
  focus, direct field-edit shortcuts, view navigation chords, and consistent
  loading feedback across server-backed searches. (REEF-344, REEF-369)
- **More ways to share and connect work.** Issues can be copied as direct links,
  and external references now support Jira and Confluence alongside the existing
  providers. (REEF-328, REEF-329)

### Changed

- **Jira import ordering is preserved in Reef.** Trusted migration plans can map
  Jira Rank into Reef's issue-wide numeric ordering, and the Kanban board uses
  that ordering when no explicit user sort overrides it. (REEF-393)
- **AKB compatibility is more tolerant.** Reef accepts both the legacy and newer
  structured AKB error envelopes when handling not-yet-provisioned workspaces.
  (REEF-363)

### Fixed

- **Attachment tables provision reliably.** Reef no longer attempts to create
  AKB-managed timestamp columns and recognizes AKB's canonical numeric and JSONB
  type names during schema verification. (REEF-404)
- **Markdown and AKB links behave consistently.** Rendered issue-body links open
  without moving the editor selection, and deployed document backlinks resolve
  the AKB web URL at request time. (REEF-368, REEF-400)
- **Planning views render stable, accurate state.** Cached planning data no
  longer causes a hydration mismatch, and sprint, milestone, and release badges
  use planning-specific status semantics. (REEF-396, REEF-398)

### Migration

- **Update the Reef workspace skill/runbooks to version 16.** The update adds
  portable issue-body link rules, importer-owned rank guidance, Jira and
  Confluence external-reference types, and the attachment table contract.
  Existing workspaces surface the normal skill-update prompt.
- **Prefer `AKB_WEB_URL` for deployed AKB backlinks.** The URL is now read from
  server runtime configuration. `NEXT_PUBLIC_AKB_WEB_URL` remains supported for
  compatibility, so no immediate environment migration or data backfill is
  required.

### Operational

- **Jira migration tooling is now a separate private package.** The read-only
  operator package covers Jira payload retrieval and redaction, account mapping,
  Rank mapping, and deterministic Version/Sprint planning contracts. It does not
  yet perform the final issue import. (REEF-311, REEF-317, REEF-391, REEF-402)
- **Background orchestration has a separate runtime package.** The new private
  package provides configuration, dry-run startup checks, an idle loop,
  graceful shutdown, and a boundary that keeps long-running workers out of the
  web process. (REEF-379)
- **Breaking: the legacy `/api/chat` endpoint has been removed.** Ask AI
  streaming now uses `POST /api/agents/runs` with
  `task_id: "chat.workspace"`; proxies must keep SSE buffering disabled.
  (REEF-371)
- **Development and container installs use pnpm 11.10.0.**
- **No Docker Hub image is published for v0.7.0.** This cut is distributed by
  source and Git tag; local image build verification remains part of the release
  gate.

## v0.6.1 - 2026-07-02

### Added

- **Delete a workspace from Settings.** The workspace owner now has a "Danger
  zone" at the foot of Settings › Workspace with two ways to clear out a
  workspace that was created by mistake or is no longer used. **Remove reef**
  deletes reef's issues, planning, activity, comments, and templates while
  leaving the underlying akb vault and any non-reef documents untouched — useful
  when reef was added to a vault your team still uses for other things; you can
  set reef up there again later. **Delete workspace** permanently removes the
  entire vault, including every document, file, and its history, and asks you to
  type the workspace name to confirm because it cannot be undone. Both actions
  are visible only to the workspace owner; after either one, reef switches you to
  another workspace you can access, or to onboarding if none remain. The action,
  who ran it, and the target workspace are written to the server audit log before
  it runs (REEF-322, epic REEF-001).

### Changed

- **The workspace you're viewing now lives in the URL.** Every in-app screen is
  now addressed as `/workspace/{workspace}/…` (for example
  `/workspace/reef-acme/issues` or `/workspace/reef-acme/issues/REEF-101`)
  instead of the old flat `/issues`, `/planning`, `/settings/…` paths. Three
  things this fixes: a link you paste into Slack or email opens in the workspace
  you meant — not whatever the recipient happened to have selected; two browser
  tabs can show two different workspaces at once without fighting over a single
  shared pointer; and switching workspaces deep-links straight to that
  workspace's board. The previously-selected workspace is remembered as your
  per-browser default, so opening reef at the root still drops you on your last
  workspace. **Old links keep working**: a bookmarked or shared `/issues/REEF-101`
  (any old flat path) redirects to its `/workspace/{default}/…` equivalent,
  preserving the query string; if you have no remembered workspace yet it sends
  you to onboarding. Opening a `/workspace/{workspace}/…` link for a workspace you
  are not a member of shows an explicit "no access" screen with your own
  workspaces to switch to, rather than silently falling back (REEF-315, epic
  REEF-001). Operational note: this is a client-side route change only — the BFF
  still receives the workspace via the existing `?vault=` / `X-Reef-Vault` /
  request-body channels, so there is no API, session-cookie, or persistence
  change.

- **Editing an issue re-requests fewer list views.** When you change a field on
  an issue (status, priority, assignee, sprint, …), reef now refetches only the
  saved list/board views that field can actually affect, instead of every open
  list view. The edit still appears immediately everywhere — the change is
  written into every cached view in place — so this only trims redundant
  background `/api/issues` requests, reducing server and akb load on busy boards.
  No behavior or data change (REEF-323).

- **The landing issue list loads faster.** Opening reef on your default issue
  view (the "My Issues" landing, before you apply any filter) used to fan out
  four sequential calls to the workspace backend — resolve who you are, find the
  active sprint, probe whether you have any issues, then fetch the list — and
  each hop added round-trip latency. reef now reads your identity from the
  session you already hold and folds the sprint and "do I have any issues?"
  lookups into the single list query, so the same landing typically makes one
  backend call (two for older sessions). Same issues, same My-Issues /
  active-sprint fallback ordering, same pagination — just a quicker first paint
  and less backend load. No behavior or data change (REEF-324).

### Fixed

- **Sorted issue lists stay in true order after any edit.** A saved list sorted
  by "Recently updated" (or by due date, title, or estimate) now refreshes from
  the server after you edit an issue's title, labels, due date, estimate, parent,
  or relations — previously only status/priority-class edits refreshed those
  views, so the saved ordering of those lists could drift out of sync with the
  server (most visibly while several people edit the same board at once) until the
  next reload. Your own edit still appears instantly, and the fix folds the two
  refetch paths into one order-aware rule, so a single edit only re-requests the
  views it can actually reorder — not every open list (REEF-325, follow-up to
  REEF-323, epic REEF-002).

- **No more board flicker / console error when reopening a workspace.** After
  the move to workspace URLs, hard-reloading or deep-linking an issues view
  (board, list, timeline, backlog, reports, My Work) could momentarily render
  the cached issues against the server's loading skeleton, which the browser
  reported as a hydration mismatch and recovered from by re-rendering. The cached
  view is now revealed one beat after the page mounts so the first paint matches
  what the server sent — the recoverable error and its flash are gone, and a warm
  cache still paints almost instantly (REEF-327, regression from REEF-315).

## v0.6.0 - 2026-06-26

### Added

- **SSO-first login: skip the button when SSO is the way in.** Deployments where
  workspace SSO is the primary identity can opt into sending visitors straight to
  Keycloak on `/login` — no "Continue with workspace SSO" click first — by setting
  the server-only `REEF_SSO_AUTO_REDIRECT=1`. The decision is made server-side so
  there is no panel flash before the bounce, and the original post-login
  destination is preserved. It only fires when akb actually reports Keycloak
  enabled (a safe no-op otherwise), never on an SSO/session error (`?sso_error=` /
  `?error=`, so a failed SSO can't loop), and never when the password escape hatch
  is requested (`/login?password=1` or `?prompt=login`), which keeps password
  sign-in reachable if SSO is down. The default is unchanged: deployments that do
  not set the variable still get today's button-first panel (REEF-312, epic
  REEF-084). Operational note: `REEF_SSO_AUTO_REDIRECT` is a new optional
  deploy-time environment variable.
- **A workspace switch to turn AI activity scanning on or off.** Settings ›
  Workspace › General now has an *Activity scanning* toggle that controls whether
  reef scans the workspace's monitored repositories and proposes issue drafts and
  status changes in the activity inbox. It is a team-shared, admin-managed setting
  (writers can change it; readers see it read-only) stored alongside the other
  workspace settings, not a per-person browser preference — so one toggle governs
  scanning for everyone. **Scanning is now off by default**: a workspace performs
  no AI activity scanning until an admin turns it on, because a scan writes
  suggestions into the shared inbox. While it is off, the manual *Refresh* control
  on the Activity feed is hidden and the on-mount auto-scan does not run; the
  single server-side scan path no-ops for manual scans, agent runs, and any future
  worker alike (REEF-313).
- **The rest of the screen now follows the interface language.** With Korean
  selected, the body copy across every surface renders in the selected language,
  not just the sidebar chrome and field labels: the issue board/list/detail/
  create/filter screens, settings, reports, the activity feed, planning, My Work,
  the timeline, the AI dialogs, onboarding, and sign-in. Buttons, section
  headings, empty and error states, placeholders, the markdown-editor toolbar,
  and the keyboard-shortcut help all localize, so a Korean PM no longer reads an
  English heading or button sitting above an already-translated value
  (the "half-translated screen" the work set out to remove). The timeline's
  month-year header now formats its month names locale-aware as well. A one-way
  build guard tracks the migration, and every hardcoded interface string it
  covers is now routed through the message catalog with a Korean translation
  (REEF-298, completing epic REEF-178; brand names and example/format
  placeholders such as `reef`, `REEF`, and `https://example.com` stay verbatim).
- **Issue field *names* now follow the interface language.** The header words
  that label a field — Assignee, Requester, Reporter, Priority, Severity, Labels,
  Due, the Sprint/Milestone/Release planning fields, Type, Status, the dependency
  filter, and Parent — render in the selected language across the issue detail
  rail, the issue filters, the report scope bar, the new-issue dialog, and the
  activity draft editor, so a field's name is localized alongside its
  already-localized value instead of the name staying English above a translated
  value. The framework-agnostic `core` package owns the English base catalog for
  these field names as pure data and `web` resolves the active locale, the same
  split as the existing field-value labels (REEF-301).
- **The remaining field and picker placeholders now follow the interface
  language.** A handful of shared issue-screen controls still showed English with
  Korean selected because their copy lived where the build guard cannot see it —
  component default values and strings assembled in code around an
  already-translated word. The date picker's "Set date" placeholder, the
  sprint/milestone/release picker's "Select …"/"No …" wrappers (which read
  "Select 스프린트" in Korean), the member search box, and the combobox
  loading/no-results states now localize, as do the priority, severity,
  label-remove, and date-clear accessible labels (REEF-309, a follow-up to
  REEF-299 under epic REEF-178).
- **Issue field labels now follow the interface language.** Status, priority,
  type, severity, close-reason (and its hints), the board/list sort field and
  direction labels, the due/dependency filter facets, and the planning
  sprint/milestone/release labels render in the selected language (English or
  Korean) everywhere they appear — board columns, list, detail, filters, the
  activity timeline, reports, and the planning page. The framework-agnostic
  `core` package owns the message keys (the enum values) and the English base
  catalog as pure data; `web` resolves the active locale through next-intl and
  falls back to English for any label a locale has not translated yet. The
  remaining hardcoded interface strings and date/number formatting are localized
  by later work (REEF-292).
- **More interface strings follow the language — toasts, table headers, and
  search.** With Korean selected, the success/error toast notifications across
  templates, workspace instructions, the activity scan, issue create/delete/move,
  and planning create/save/delete now render in Korean, as do the issue-list
  column headers, the AI enrichment field labels and empty states, the ⌘K search
  and add-member directory status messages, and the reports risk-map priority and
  age labels. These all lived in places the original hardcoded-string guard could
  not see (data structures and `toast()` arguments); the guard now also flags a
  new hardcoded English string added to a `toast(...)` call, so the gap cannot
  silently reopen (REEF-299).
- **Choose the interface language (English or Korean).** Settings > Preferences
  now has a Language switcher next to Appearance. The choice applies immediately,
  is remembered per device (stored in IndexedDB and mirrored to a `NEXT_LOCALE`
  cookie), and is used to render the correct language — and `<html lang>` — from
  the first server paint on the next visit; a first visit with no saved choice
  follows the browser's `Accept-Language`, falling back to English. This ships
  the i18n runtime (next-intl, cookie-based, no URL locale routing) that later
  work builds on; only the new Language section itself is translated so far
  (REEF-291).
- **The sidebar and shared empty state now follow the interface language.** With
  Korean selected, the left navigation (Issues, My Work, Planning, Activity,
  Reports, Settings), its New issue button and attention badges, and the shared
  "pick a workspace" prompt render in Korean; any string a locale has not yet
  translated falls back to English without breaking the layout. This is the first
  batch of the larger string migration: the rest of the UI follows in later
  changes, guarded so newly added English text can't silently slip back in
  (REEF-293).
- **Server and AI error messages now follow the interface language.** With Korean
  selected, the PM-facing errors raised by workspace, GitHub, and AI operations —
  not found, save conflict, sign-in required, the AI service being unavailable,
  invalid request, and the rest — render in Korean in their toast or dialog
  instead of English. The framework-agnostic `core` package now carries a stable
  error code (never message text) for each failure, and `web` resolves the active
  locale at its error boundary and translates that code, falling back to English
  for any message a locale has not translated yet. The remaining English error
  strings in the agent-artifact review flow are localized by later work
  (REEF-297).
- **The last inline server error strings now follow the interface language.**
  Building on the error-localization boundary above, the messages a Route Handler
  still raised directly now render in Korean too when Korean is selected: the
  deployment-config and validation replies ("GitHub App is not configured for this
  deployment", the various "Invalid … id" / "Invalid suggestion status" checks, the
  activity-suggestion review guards), the AI chat / enrichment / agent-run
  availability, session, and request errors, and the agent-artifact review flow
  (approve, edit, dismiss). The streaming agent error envelope keeps its stable
  machine `code` unchanged and carries the localized message alongside it, and any
  message a locale has not translated yet still falls back to English (REEF-308,
  completing server-error localization under epic REEF-178).
- **Tune when completed issues leave the default views.** Workspace admins can
  now set separate "Hide completed after N days" and "Hide canceled after N
  days" windows from Settings > Workspace > General. The values are stored in
  `reef_settings`, default to 28 / 7 when unset or invalid, and the Board, List,
  Backlog, and Timeline views re-evaluate resolved issue visibility after the
  setting is saved (REEF-278).
- **Long-resolved issues drop out of the default views, with a one-click
  reveal.** Completed and canceled issues older than the configured windows are
  now hidden from the Board, List, Backlog, and Timeline by default so the active
  work stays in front. A consolidated **Display** popover on the issue toolbar
  gathers the reveal controls — *Show completed* and *Show archived* — and the
  choice is URL-synced (`?stale=1`) so a revealed view survives a refresh or a
  shared link, replacing the lone "Show archived" chip (REEF-275).
- **Pick monitored repositories without a personal access token.** When a
  deployment configures a GitHub App, the repository picker in Settings (and the
  new-workspace form) now lists and saves monitored repos through the
  server-managed App installation, so a workspace admin no longer has to put a
  GitHub credential in every browser just to configure repo grounding. Saved
  repositories keep their stable GitHub id and owner/name (REEF-239 / REEF-244).
- **Scan repository activity without a personal access token.** When a
  deployment configures a GitHub App, both the manual **Scan** action and
  agent-run activity scans now read monitored-repo commits and pull requests
  through the server-managed App installation, so generating activity-inbox
  suggestions no longer requires a browser-stored GitHub credential. Deployments
  without a GitHub App now surface GitHub-specific features as unavailable, and
  when the App is configured but unavailable — a revoked installation, missing
  permission, or rate limit — the scan surfaces a PM-facing error instead of
  failing silently (REEF-240 / REEF-244).
- **Ground Ask AI, enrich, and agent runs without a personal access token.**
  When a deployment configures a GitHub App, the monitored-repo code grounding
  behind Ask AI and agent runs (`/api/agents/runs`) plus issue enrichment
  (`/api/enrich`) now reads repositories through the server-managed App
  installation, so AI answers can cite repo code without a GitHub PAT in the
  browser. Because grounding is an enhancement, any GitHub unavailability — no
  deployment-managed credential, an unverified session, or a revoked /
  rate-limited App — now degrades cleanly to AKB-only answers instead of failing
  the request (REEF-243 / REEF-244).
- **Verify GitHub grounding locally and in CI without a GitHub App.** A new
  optional `REEF_GITHUB_PAT` deployment env var lets a server read GitHub with a
  read-only personal access token when no GitHub App is configured, so local
  development and CI can exercise the real repo picker, activity scan, and AI
  grounding without each browser supplying a PAT. It is a deployment-managed
  secret (never per-user), disabled unless set, and used only when no App is
  configured — credential precedence is GitHub App, then this server PAT — so it
  never overrides or becomes a production deployment's primary credential
  (REEF-290).
- **Spot outdated workspace AI instructions from the sidebar.** When your active
  workspace is running an older agent playbook, the sidebar **Settings** entry
  now shows a small amber dot, so the drift is discoverable without opening
  settings first. The dot clears as soon as you apply the update — and applying
  it now confirms with a brief "Workspace instructions updated." message — and it
  stays hidden while the status is still loading or already current (REEF-257).
- **Drill through related issues without losing your place.** Following a
  parent breadcrumb or sub-issue from an open issue now swaps the side panel to
  that issue in place and shows a top-left **Back** to the issue you came from,
  so you can explore the relationship graph and step back one issue at a time.
  **Close** (the ✕, an outside click, or Esc when you're not drilled in) exits
  straight to the list in one action instead of unwinding every hop, and Esc
  steps back while you're drilled in. Opening an issue fresh, refreshing, or
  following a deep link starts with no Back, as before (REEF-270).
- **Filter issues by several people, sprints, or releases at once.** The
  Assignee, Requester, Sprint, and Release filters now accept multiple values
  and match any of them (OR within a field, AND across fields) — the same
  multi-select the Status, Type, and Priority filters already had — so you can
  ask for "Alice or Bob's issues" or compare "Sprint 3 and 4" in one view. The
  selection serializes to the URL and restores on revisit or share. Assignee and
  Requester now match a login exactly rather than as a substring, so filtering to
  one person no longer pulls in others whose login contains it. Milestone stays
  single-select (REEF-267).
- **The activity timeline now shows assignee, priority, and planning changes.**
  Reassignments, priority changes, and planning links (milestone, sprint, and
  release attach/detach) — already recorded in the log — now render as their own
  one-line entries in an issue's Activity thread, next to status changes and
  delivery. Planning links read by name rather than a raw id, and a linked
  delivery ref still appears once, not twice (REEF-276).
- **The activity timeline now records title, labels, due date, estimate, parent,
  relations, and archive changes.** Editing an issue's title, labels, due date,
  estimate, parent, a relation (depends on / blocks / related to), or archiving
  and restoring it now leaves its own one-line entry in the Activity thread —
  completing the change history alongside status, assignee, priority, and
  planning. Every change from one save groups under a single moment, and an
  older deployment that does not yet understand a new entry type simply skips it
  instead of erroring. Workspaces created on an earlier version can pick up the
  matching agent-playbook update from Settings > Workspace (REEF-277).

### Changed

- **Dates, times, and relative timestamps follow the interface language.**
  Calendar month and weekday headers, due/target/synced dates, the report chart
  axis labels (throughput and Monte Carlo forecast), comment and activity
  "5m ago" / "2d ago" timestamps, and the hover tooltips now render in the
  selected language (e.g. `Jun 1, 2026` /
  `2026년 6월 1일`, `2d ago` / `그저께`) instead of always English. The calendar
  day stays pinned to UTC so the rendered date is identical for every viewer and
  matches what the server first painted; only the language varies. The AI/LLM
  date context is intentionally left in fixed `en-US`. Numeric integer
  formatting is unchanged (identical across English and Korean) (REEF-294).
- **Removed browser GitHub PAT setup and storage.** Settings > Preferences and
  onboarding no longer collect monitored-repo Personal Access Tokens, the web
  client no longer attaches GitHub `Authorization` headers, and Dexie v11 drops
  the legacy `credentials` store so stale browser tokens stop being readable.
  GitHub-specific repo listing and activity scan surfaces now require a
  deployment-managed GitHub credential; Ask AI and enrichment continue AKB-only
  when GitHub is unavailable (REEF-244).
- **Sidebar footer shortcuts and release notes are easier to find.** The
  keyboard shortcuts launcher now sits directly in the sidebar footer instead of
  hiding inside the account menu, and the account menu's version row is now a
  **What's new** link to the current `appVersion` GitHub Release tag while still
  showing the exact version for bug reports (REEF-170).
- **New workspaces start from issue-type-aligned templates.** The default issue
  templates seeded by Settings → Templates now match reef's issue types — Epic,
  User story, Task, Bug, Spike, and Chore — replacing the previous Bug / Feature
  / Task / Tech debt set. Story and Bug ship with `Given / When / Then`
  acceptance criteria, and the other types carry a done-definition that fits
  them (epic success criteria, task checks tied to the parent story, spike
  recommendation, chore verification). Each template also carries the practical
  sections proven on reef's own board — bug boundaries and verification, epic
  requirements, task testing — kept general rather than reef-specific. Templates
  still seed each issue's kind label; you continue to pick the Type in the create
  dialog. Workspaces that already seeded templates keep them unchanged (REEF-256).
- **Related, blocking, and dependency links now drill in place like the rest.**
  Clicking a depends-on, blocks, or related issue in an open issue's
  Relationships swaps the panel to that issue and adds it to the same **Back**
  trail as the parent breadcrumb and sub-issues — keeping the list or board you
  came from behind it — instead of opening as a separate navigation that lost
  your place. The drill **Back** and **Close** now share one row at the top of
  the panel, so they line up instead of Back sitting on its own strip above the
  header (REEF-284).
- **The issue panel's top bar is now one steady strip.** The issue id, its
  status and type, the parent breadcrumb, and the **Back** / **Close** controls
  now live in a single bar that stays put while the issue below it loads — so the
  id and Close never blink when you drill into an issue that isn't cached yet, and
  only the title, description, side rail, and timeline show a loading skeleton.
  This also removes the empty strip that used to sit above the header when you
  weren't drilled in: the id always fills the bar's left and **Close** is the one
  control on its right, in every state (REEF-286).
- **Loading skeletons are quieter for screen readers.** While a page, panel, or
  feed is loading, assistive technology now hears a single "Loading…" status
  instead of walking through the empty placeholder bars — the decorative skeleton
  trees are hidden from the accessibility tree and a sibling status region
  carries the announcement. Real page and section headings stay readable, and
  nothing changes visually (REEF-281).
- **Reports names its workspace, like every other page.** The Reports header now
  shows the active workspace as a subtitle, matching the Issues, Planning, and
  Activity headers so the page's vault scope is visible at a glance. Page-header
  subtitles (the workspace name, or `@login` on My Work) are now marked as
  identifiers so machine translation leaves them untouched (REEF-260).
- **Click a planning row's name to open its details.** On the Planning list
  (sprints, milestones, releases), clicking a row's name now expands and
  collapses its detail body, not just the small chevron — the chevron and name
  are one larger, keyboard-accessible toggle instead of two controls for the same
  panel. Rows with no detail stay plain text with no toggle (REEF-264).
- **Backend logs explain what the server is doing.** Operators get more from
  stdout: every `/api/*` request line now names the acting user (the akb
  username, never a token), activity scans log step-by-step checkpoints and a
  one-line completion summary instead of going silent for minutes, LLM calls
  record token usage, akb/GitHub upstream calls record their HTTP status, latency,
  and remaining GitHub rate limit, slow requests are flagged at WARN, and API
  errors keep their upstream HTTP status. In a deployment that exports traces
  this rich data lives on the traces; set `REEF_RESPONSE_LOG=1` (and optionally
  `REEF_SLOW_REQUEST_MS`) to also surface it on stdout where there is no trace
  backend. Credentials are never logged (REEF-271).
- **The segmented toggles look and behave alike, and show keyboard focus.** The
  issue view switcher (Board / List / Timeline / Backlog), the Settings tabs, and
  the Planning kind toggle now share one size, spacing, and focus style. The view
  switcher, which previously gave keyboard users no visible focus indicator, now
  shows the same focus ring as the others, and the Planning toggle is no longer a
  larger outlier (REEF-261).
- **Relation chips in the create and draft forms finish their accessibility.**
  The plain relation chips in the create dialog and activity-draft editor now
  show a keyboard focus ring on their remove `X` (matching the detail panel's
  chips), hide that decorative `X` from screen readers while the button keeps its
  "Remove {id}" name, and mark the chip id so machine translation leaves the reef
  id intact. The chips stay non-navigating and look exactly the same (REEF-282).
- **Internal navigation no longer does a full page reload.** The My Work and
  Backlog "Go to the board" links and the issue-detail and activity-feed
  **Settings** links now client-navigate through Next's router instead of a hard
  document load, so moving between these surfaces keeps the warm IndexedDB and
  query cache and feels instant (REEF-262).
- **One shared empty state when no workspace is selected.** The "pick a
  workspace" prompt on the issues, My Work, planning, reports, and activity
  surfaces now renders one shared `EmptyWorkspaceNotice` with the same copy,
  link, and framing, instead of five slightly different empties (REEF-259).

### Fixed

- **A single malformed delivery/external ref no longer hides an entire issue.**
  The read path validated every `reef_issues` row against the issue schema and
  silently skipped any row that failed, so one `implementation_refs` or
  `external_refs` entry written in a shape the ref schema rejects — a delivery
  ref keyed by `name`/`sha`/`number` with no required `ref`, or an unknown
  `type` such as `evidence` — dropped the whole issue from the board, list,
  search, and its parent's sub-issue list, with no error surfaced to the PM.
  These two fields live in the ad-hoc row `meta` JSON that an external writer
  (a code-activity scan, a sibling automation) can fill, so they are now
  sanitized per entry: the entries that validate are kept, the invalid ones are
  dropped, and the drop is recorded as a backend warning. Core issue fields stay
  strictly validated, so a genuinely corrupt row still fails loudly.
- **Activity scans can no longer read a repository the workspace does not
  monitor.** The manual **Scan** action and agent-run activity scans now verify
  the requested owner/repo against the workspace's monitored repositories before
  reading any GitHub activity, rejecting an unmonitored repo with a PM-facing
  error. Since scans began running on a deployment's server-managed GitHub App
  installation (REEF-240) — a credential that can read every repository the App
  is installed on — an authenticated workspace user could otherwise have scanned
  an arbitrary App-installed repo and pulled its commit/PR activity into their
  inbox. This applies the same monitored-repo boundary already enforced for Ask
  AI code grounding and issue enrichment (REEF-289).
- **Esc now closes the open dropdown, not the whole issue editor.** While
  editing an issue, pressing Esc with an open Assignee/Sprint/Release/Labels
  picker, a Start/Due date popover, a relationship dropdown, or the ⋮ actions
  menu now closes just that overlay and leaves the issue panel open — matching
  how the Status/Priority/Type selects already behaved. Previously Esc dismissed
  the entire panel (and the New issue / Planning editor dialogs behaved the same
  way), because these custom overlays did not participate in the dialog's
  keyboard-dismiss stack. When no overlay is open, Esc still steps back or closes
  the panel as before (REEF-288).
- **Related-issue and sub-issue rows no longer hide their title.** In the issue
  detail, the Depends on / Blocks / Related rows, the relationship picker, and
  the Sub-issues list now lay their issues out as aligned columns — status, id,
  title, type, priority — so the title always keeps a readable width instead of
  collapsing to nothing once a "blocked" marker appeared in a narrow column, and
  the type and priority columns line up from row to row whether or not a row has
  a priority. The "blocked" marker is now a compact glyph with its count (the
  full "Blocked by N issues" stays available to screen readers), and in a
  too-narrow column the type label folds to its glyph to keep the title legible
  (REEF-285).
- **The parent breadcrumb no longer flashes a raw issue number before its
  title.** Opening a sub-issue from a deep link or a cold cache used to briefly
  show the parent's raw id (for example `REEF-273`) in the header breadcrumb
  until the issue list finished loading, then swap it for the parent's title.
  The breadcrumb now holds a neutral placeholder while the list loads and fills
  in the title with no visible "number → title" flicker. A parent that is
  genuinely missing from the loaded list still falls back to its id so the link
  stays usable (REEF-283).
- **Switching issue views no longer flickers or feels laggy.** Clicking between
  the Board, List, Timeline, and Backlog tabs now keeps the current view on
  screen and swaps in the next one without flashing the board-shaped loading
  skeleton — the four views already share the same cached data, so the switch is
  now instant instead of stalling on a blocking re-render. The switcher shows a
  faint "busy" dim while a heavier view prepares, and respects the reduced-motion
  setting. The `?view=` URL still updates, so deep links, bookmarks, and
  back/forward are unchanged (REEF-265).
- **Sign-out now clears every open tab.** Signing out of a workspace in one
  browser tab now also clears the cached account data in the other reef tabs
  open on the same browser, so a shared computer no longer keeps showing the
  previous account's boards or activity after sign-out. This only clears the
  in-memory query cache across tabs — there is no persisted cache-format change
  and no schema buster bump, so existing sessions are not forced to refetch.
  Falls back gracefully where cross-tab messaging is unavailable, and single-tab
  sign-out is unchanged (REEF-106).
- **Navigate up to the parent issue.** The issue detail now shows a clickable
  breadcrumb above the id line — the parent's status icon and title — so you can
  jump to the parent in one click, mirroring how the Sub-issues list already
  navigates down to children. The crumb reads by status glyph and title (the raw
  id stays in the link target, off screen); a parent missing from the loaded list
  falls back to its id so the link stays usable. The `Parent` field under
  Relationships stays edit-only for reassigning, and the breadcrumb is hidden for
  top-level issues (REEF-266, REEF-279).
- **The Close issue reason picker no longer looks broken.** When you close an
  issue, the selected close reason now reads as one clean line on the picker —
  left-aligned with the dropdown's option labels — instead of the squished,
  misaligned two-line value it showed before. The dropdown still lists each
  reason with its helper line. The dialog also drops a redundant "Closed" chip
  and adopts the same width and field framing as the Delete and planning dialogs
  (REEF-272).
- **Jump to a depends-on, blocks, or related issue in one click.** On the issue
  detail, the Depends on / Blocks / Related chips now read as self-describing
  rows — status icon, id, and title — and clicking one opens that issue, the same
  as the Sub-issues list and the parent breadcrumb already do. Removing a
  relation still uses the `X`, which no longer navigates. A relation pointing at
  an archived or missing issue degrades to an id-only link rather than dropping
  navigation. The create and activity-draft forms keep the plain, non-navigating
  chips so clicking one never abandons an unsaved issue (REEF-268).
- **The issue activity timeline is easier to use with a keyboard, screen reader,
  or browser translation.** Tabbing to the collapsed "N status changes" toggle
  now shows a visible focus ring; an event or comment older than a week shows a
  localized date (for example "Jun 1, 2026") instead of a bare `2026-06-01`; a
  failed load of the timeline is now announced to assistive tech instead of
  appearing silently; the expand chevron and the comment edit button stop
  animating when you ask for reduced motion; and code identifiers — logins and
  PR/commit/branch references — are no longer mangled by automatic page
  translation. Wording, layout, and behavior are otherwise unchanged (REEF-287).
- **Route and content skeletons no longer shift the layout on load.** The
  loading skeletons for the issues toolbar and list, the issue detail, Reports,
  My Work, and the activity feed now match the real content's dimensions, so the
  first paint no longer jumps when the data hydrates (cumulative layout shift is
  gone on those surfaces). This is separate from the screen-reader skeleton work
  above; only the measurements changed (REEF-258).
- **Clicking a link in an AI answer or comment no longer breaks the page.** The
  link-safety confirmation shown before opening an external link from a
  Streamdown-rendered AI response or issue comment now renders through a portaled
  dialog instead of inside the paragraph text, fixing a React hydration error
  that could blank the surrounding content. The confirmation copy is localized
  (English and Korean) (#104).

### Security

- **Bumped dompurify to 3.4.11 to resolve GHSA-cmwh-pvxp-8882.** The transitive
  dompurify dependency (pulled in through mermaid/streamdown for AI-rendered
  markdown) is pinned via a workspace override to 3.4.11, clearing a published
  advisory about `ALLOWED_ATTR` prototype pollution. No user action required (#40).

### Migration

- The Reef vault skill / runbook documents were updated (now version 14) to add
  the assignee, priority, planning-link, title, labels, due-date, estimate,
  parent, relation, archive, and delivery-ref activity event types to the issue
  timeline. New vaults install the current documents at creation; existing vaults
  should rerun vault skill installation (offered from Settings > Workspace) before
  relying on generic AKB agents for the expanded activity log (REEF-276, REEF-277).
- Dexie schema `version(11)` drops the legacy browser `credentials` store as part
  of removing the browser GitHub PAT flow. Stale browser-stored GitHub tokens
  become unreadable on first load after upgrade; no user action is required
  (REEF-244).

### Operational

- **Server-managed GitHub grounding replaces the browser GitHub PAT.**
  Monitored-repo listing, the activity scan, and Ask AI / enrich / agent-run code
  grounding now read GitHub through a deployment-managed GitHub App. Configure it
  with `REEF_GITHUB_APP_ID`, `REEF_GITHUB_APP_INSTALLATION_ID`, and
  `REEF_GITHUB_APP_PRIVATE_KEY` (the private key is provided by the Kubernetes
  `reef-web-secret`); `REEF_GITHUB_PAT` is an optional read-only fallback for
  local/CI only and never overrides a configured App. A deployment with neither
  surfaces GitHub-specific features as unavailable rather than failing. These are
  deployment-managed secrets — never per-user and never logged (REEF-238,
  REEF-239, REEF-240, REEF-243, REEF-290).
- **AI activity scanning is now off by default.** A workspace performs no AI
  activity scanning until an admin enables it from Settings > Workspace > General,
  because a scan writes suggestions into the shared activity inbox. Existing
  workspaces start in the off state after upgrade (REEF-313).
- **Optional SSO-first login.** Set `REEF_SSO_AUTO_REDIRECT=1` to send visitors
  on `/login` straight to workspace SSO (Keycloak) when akb reports it enabled,
  skipping the button-first panel. It is a safe no-op when SSO is not enabled,
  never fires on an SSO/session error, and always leaves the password escape hatch
  (`/login?password=1`) reachable. Unset keeps today's button-first login
  (REEF-312).
- **Optional stdout logging knobs for trace-less deployments.**
  `REEF_RESPONSE_LOG=1` surfaces the per-request access line and backend
  observability lines on stdout where there is no trace backend, and
  `REEF_SLOW_REQUEST_MS` (default 1000) sets the threshold at which a slow request
  is logged at WARN. Credentials are never logged (REEF-271).

## v0.5.0 - 2026-06-19

### Added

- **Unified activity timeline on issues.** The issue detail's Comments section
  becomes a single chronological Activity thread that interleaves comments with
  status changes and events reconstructed from the issue itself — creation, each
  recorded delivery (PR/commit/branch), and how it was closed. Older issues fill
  in with no backfill, since events are synthesized at read time and a change
  already in the log is never shown twice. Comments keep their avatar cards;
  system events read as lighter one-line entries, and a run of three or more
  consecutive status changes folds into one expandable row (REEF-064).
- **Issue activity log (status changes).** Every status change now records an
  immutable, append-only event — who moved it, from and to which status, and
  when — captured the moment the change is saved, whether from the app or an
  automated agent. This is the foundation the unified timeline reads (REEF-063).
- **Activity log now tracks more than status.** Beyond status changes, the log
  now records reassignments, priority changes, planning links (milestone, sprint,
  release attach/detach), and newly-linked delivery refs (pull requests, commits,
  branches) — each an immutable event with who, the before→after, and when.
  Fields changed in one save share a timestamp so they read as one moment
  (REEF-126).
- **Comments on issues.** Each issue gains a Comments section: leave a note, read
  the thread oldest-first with author and time, and edit your own (an "edited"
  marker shows). Comments render markdown including inline `code`, and `⌘↵`
  posts. This is the flat first cut — threads, reactions, and the merged timeline
  come later (REEF-062).
- **A personal "My Work" view.** A dedicated `/my-work` page shows the issues
  assigned to you, auto-scoped to your account. A summary strip counts your
  in-progress, due-soon, overdue, open-by-stage, and sprint remaining/done work;
  below it a focus-sorted queue orders by urgency, then priority, then closeness
  to active, and flags blocked items. Toggle the queue between a flat priority
  list and a by-status grouping. (The sidebar entry point and attention badge
  ship in REEF-204.) (REEF-181).
- **My Work sidebar entry with an attention badge.** A My Work item joins the
  sidebar nav (second, after Issues), badged with the count of your overdue and
  due-soon issues so the number of things needing attention is visible without
  opening the page (REEF-204).
- **Manage who's in a workspace from Settings.** The Workspace → Members tab
  lists everyone with access to the active workspace and their role. Admins and
  owners can add an existing akb user via directory search, change a member's
  role inline, or remove a member — the owner can't be removed and you can't
  remove yourself; writers and readers see it read-only. There is no email invite
  (akb has none), so this grants access to people who already have an akb account
  (REEF-179).
- **Delivery forecast on Reports.** A new Monte Carlo forecast card projects when
  the open work in scope will finish, and how many items finish by a near-term
  date, each at the 50/70/85/95 confidence levels. It bootstraps the weekly
  throughput the dashboard already tracks — no new data or setup — and reuses the
  Period control for the sample window (default 12 weeks). Thin history is
  labeled as rough rather than guessed (REEF-190).
- **Custom pivot (crosstab) report.** A new Pivot card lets you pick any two
  categorical fields — status, type, priority, severity, assignee, or label — for
  the rows and columns and see a count-based crosstab without an engineer
  shipping a new card. Cells shade by count, empty intersections read blank, and
  a Total row, column, and grand total close the margins. High-cardinality fields
  show the busiest buckets and fold the rest into a named "Other" lane. It always
  measures by issue count (REEF-189).
- **Measure Reports by story points, not just issue count.** The report scope bar
  gains a Measure control: switch to "Story points" and the load and throughput
  cards — Workflow, By type, By severity, Top assignees, Top labels, and
  Throughput — re-weight by summed estimate points instead of counting issues.
  Issues with no estimate count as zero points, so the toggle never changes which
  issues are included. Count stays the default; the risk map, deadlines, and
  headline tiles remain count-based (REEF-188).
- **"By severity" report card.** Reports gains a By severity breakdown of the
  in-scope issues, alongside the existing By type, Top assignees, and Top labels
  cards, and honoring the count/points Measure toggle (REEF-186).
- **Portfolio health on Reports, including a roll-up by parent epic.** Reports
  shows a Portfolio health rollup beneath the headline numbers: a worst-first
  list of your milestones, sprints, releases, and parent epics, each with a
  computed On track / At risk / Off track verdict from overdue and blocked work,
  pace against the target date, and backlog growth (sprints also weigh done work
  against declared capacity). Toggle between the dimensions, and click any row to
  scope the detail charts below — clicking a parent scopes them to its children.
  Shipped planning items stay hidden until toggled on (REEF-191, REEF-187).

### Changed

- **Calmer loading skeletons.** Loading placeholders now read as one quiet light
  sweeping across a panel instead of every bar blinking in lockstep, and the
  issue detail placeholder fades its labels below its values to hint the loaded
  hierarchy. The sweep flattens to a static two-tone for anyone who prefers
  reduced motion. No new colors, chips, or fonts (REEF-250).
- **Snappier editing — changing one issue no longer reloads the whole list.**
  Editing an issue's title, dates, labels, or other non-membership fields now
  updates just that card in place instead of re-fetching and re-rendering the
  whole board/list. Edits that move an issue between filters/columns, change its
  sort position, or alter its dependencies still refresh the affected views; an
  active text search refreshes only itself. Switching workspaces or signing out
  clears the in-memory issue cache (REEF-098).
- **Faster first load — the rich-text editor loads on demand.** The markdown
  editor and its formatting engine (TipTap/ProseMirror) are no longer part of the
  initial app bundle; they load the first time you open a surface that edits text
  (creating or editing an issue, the planning editor, a settings template). A
  height-matched placeholder holds the editor's space so the form doesn't jump,
  and behavior is unchanged once it is open (REEF-220).
- **Settings is now organized into scope-based tabs.** The single long scroll is
  split into Workspace, Preferences, and Deployment tabs, each its own page — so
  back/forward, open-in-new-tab, deep-link, and bookmark all work, and adding
  settings no longer lengthens one screen. The Active Workspace selector lives on
  the Workspace tab only, which itself has General and Members sub-views governed
  by that one selector. Existing settings moved to their matching tab with nothing
  dropped (REEF-183).
- **The Reports dashboard no longer double-encodes priority and age.** The
  priority × last-update Risk map is now the single home for both axes, so the
  standalone one-dimensional By priority and Aging cards (which it already
  contained as its row and column totals) have been removed. The Risk map is
  labelled as covering open work, so its counts can't be mistaken for the in-scope
  total (REEF-184).
- **The Reports Period control now clearly scopes only the throughput window.**
  Period re-scopes the Throughput series (its sample window) rather than appearing
  to drive the whole page, and the load cards now label their populations — "In
  scope" on By type, "Open work" on Deadlines — so it's clear which numbers a
  period change does and doesn't move (REEF-185).
- **Unified visual language across Reports.** The dashboard's cards share one
  render vocabulary — neutral grey heat ramps (brand color reserved for quantity),
  consistent bars, and uniform card framing — and the risk matrix renders as a
  semantic table. Motion respects reduced-motion. Render-only; no metric changed
  (REEF-248).
- **Global search (⌘K) results are now real links.** Each result row links
  directly to the issue, so Cmd/Ctrl-click, middle-click, and right-click → "Open
  in new tab" all work; keyboard selection is unchanged. The palette also reads
  better with assistive technology — the search box has an explicit label, status
  changes are announced, and the results list no longer scroll-chains the page
  behind it. The duplicate close ✕ is gone (Esc still closes), and issue ids are
  no longer altered by browser auto-translation (REEF-221).

### Fixed

- **Pages no longer flash a blank body while loading.** Opening or refreshing
  Issues, My Work, Planning, Reports, Activity, or Settings — or following a deep
  link to an issue — now paints that page's skeleton (its board columns, summary
  tiles, cards, or rows under the real header and sidebar) from the first frame,
  instead of leaving the content area empty until the data arrived. The same
  skeleton also shows the instant a route is opened from the sidebar (REEF-255).
- **Scrolling a page to its end no longer drags the sidebar along.** When the
  body of a page is scrolled to its top or bottom edge, continuing to scroll in
  the same direction is now absorbed by the body instead of chaining out to the
  document and rubber-banding the whole shell — including the fixed left sidebar —
  on macOS trackpad/wheel overscroll (REEF-254).
- **The issue editor's loading skeleton now matches the panel's shape.** While an
  issue loads, the placeholder mirrors the real layout — the header row, the title
  and description canvas, and the property rail with its Details, People, and
  Planning sections — instead of one full-panel block that rearranged into a
  different structure the moment the issue appeared (REEF-249).
- **Editing an issue no longer silently overwrites a change made outside it.**
  Opening an issue card now always re-reads the latest from the workspace, so an
  edit made elsewhere (the akb tools, another tab) shows up instead of a stale
  cached copy. If the body, title, labels, or relations changed after you opened
  the card, saving surfaces a retryable save conflict — your view refreshes and
  you can re-apply — rather than quietly replacing their change. Plain table
  fields keep their per-field server merge (REEF-227).
- Planning filters for Sprint, Milestone, and Release no longer squeeze long
  selected names into narrow controls. Empty filters stay compact, selected names
  grow to a bounded readable width, dropdown panels open wide enough to read, and
  the Reports scope bar wraps planning controls onto readable tracks (REEF-246).
- Opening an issue from the List, Timeline, or Backlog tab no longer flips the
  background to the Board. The tab (and any active filters/sort) you were on is
  preserved while the detail sheet slides over, and closing it returns you there.
  A typed or refreshed `/issues/REEF-XXX` deep link still opens over the Board
  (REEF-222).
- **Focus outlines on form fields are no longer shaved off on the left and
  right.** Focusing a field inside a column that hides horizontal overflow — most
  visibly the Title field on the issue edit screen — clipped the teal focus
  border on its left and right edges; it now shows on all four sides while still
  keeping long content from widening the column. Focus rings across the edit,
  settings, sidebar, and activity surfaces are consistent now too: keyboard focus
  only (no flash on a mouse click), one color and weight (REEF-226).
- **The sidebar footer workspace and account triggers now show a focus ring for
  keyboard users.** Both draw the same focus-visible ring used elsewhere, the
  workspace switcher's search field opts out of password-manager and spellcheck
  prompts with a proper ellipsis (…) placeholder, and menu items highlight on
  keyboard focus only (REEF-172).
- The built-in workspace agent playbook now guards three issue-creation pitfalls:
  it surfaces the parent link so an issue filed under an epic is attached rather
  than orphaned, requires a fully-formed timestamp on status changes so an edit
  can't silently drop the issue off the board, and explains how to spot and repair
  a saved issue that a malformed field is hiding. Existing workspaces are offered
  the updated playbook from Settings (REEF-224).
- The built-in workspace agent playbook now covers reading an issue's activity
  history and reading, writing, and editing its comments, and its data-model
  reference lists the `reef_comments` and `reef_activity` tables. An agent
  operating a workspace through the akb tools can now answer "what changed on this
  issue" and work with comment threads. Existing workspaces are offered the
  updated playbook from Settings (REEF-252).

### Migration

- New AKB tables `reef_comments` and `reef_activity` back issue comments and the
  activity log. Both are provisioned lazily by `ensureReefTables` and verified
  against a guarded schema manifest stamped in `reef_settings.schema_version`: new
  vaults get them at workspace creation, existing vaults on first comment or event
  write. No manual akb migration is required (REEF-062, REEF-063, REEF-125).
- The Reef vault skill / runbook documents were updated (now version 13) to
  document comment and activity read/write, the new tables, and the three
  issue-creation guards. New vaults install the current documents at creation;
  existing vaults should rerun vault skill installation (offered from Settings)
  before relying on generic AKB agents for comments or activity (REEF-126,
  REEF-224, REEF-252).
- The persisted client query cache buster was bumped to `reef-cache-v5`. Stale
  cached issue snapshots are discarded on first load; no user action is required
  (REEF-098).

### Operational

- Backend request and error logs are now structured as one JSON line per event in
  production (pretty colorized output when running locally) via pino.
  Credential-bearing headers (`Authorization`, `X-Reef-LLM`, `Cookie`,
  `Set-Cookie`, `Proxy-Authorization`) are redacted at the logger, and logs
  emitted inside a request trace carry the `trace_id`/`span_id` so they line up
  with the OpenTelemetry spans for that request. Operators parsing reef-web logs
  should expect JSON; no other deploy action is required (REEF-235).

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
  machine can't inherit it, while preserving device preferences such as theme.
  It also carries a "Keyboard shortcuts" launcher (⌘?) and the app version
  (REEF-068).

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
- **Ask AI no longer requires GitHub code grounding.** When GitHub grounding is
  unavailable, the assistant grounds answers on your akb workspace alone
  (issues and assignees) and skips monitored-repo code search instead of failing
  the request (REEF-089).
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
- Deployments without a configured GitHub App no longer pile up repeated
  "authentication required" errors: reef treats GitHub unavailability as a
  normal deployment state, skips repository listing / auto activity scan, and
  surfaces a single unavailable hint instead of retrying (REEF-159 / REEF-244).
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
  sub-heading under its group, the project-prefix and search fields announce
  their labels to screen readers, decorative icons are hidden from them, and
  ellipses use a real character (REEF-151).

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
