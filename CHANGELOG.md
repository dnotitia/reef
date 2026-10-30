# Changelog

Product changes to reef-web, reef-event-processor, and the operator packages
share one repository version. In the `0.x` series, breaking changes ship in
minor releases and are marked explicitly below.

See the [release policy](docs/release-policy.md) for versioning and the
[deployment guide](docs/deployment.md#register-and-deploy) for rollout, retry,
and rollback procedures. `REEF-XXX` references identify Dnotitia's internal
issues, not public GitHub issues.

## Unreleased

### Fixed

- Release verification ignores historical terminal Pods and preserves independent
  explicit AKB links when checking issue relationship projections.

### Operational

- Run relationship preflight before requesting the AKB rollout and collect all
  source-data failures in the receipt. Bound requests and vault concurrency,
  checkpoint each acknowledged document write, and finish all writes before
  waiting for graph projection. Successful vaults survive sibling failures.
- Add `deploy/k8s/deploy.sh repair --receipt <path>` to resume data repair after
  verifying the deployed immutable release, without rebuilding or redeploying.
  Graph verification defaults to 30 minutes and reports progress.

### Migration

- Keep each repair receipt together with its `<receipt>.relations/` directory.
  Checkpoints record acknowledged commits and target URIs; missing acknowledged
  files stop repair. Documents without checkpoints receive a guarded write
  before verification. AKB schema v4 and vault skill version 24 are unchanged.

## v0.18.0 - 2026-10-30

### Added

- Inbox supports All and Unread filters and marking all unread notifications
  as read across accessible ready workspaces. The action includes notifications
  beyond the visible list and retries only rows that failed.

### Changed

- Inbox refreshes its list and unread badge when notifications change, after
  reconnecting, and when the event stream resumes. Entries show source issue
  titles and the original status transition when history is available.

### Fixed

- Issue details reopen correctly after closing an issue reached through a direct
  link or SSO entry.
- Dashboard navigation waits for hydration and global shortcut registration,
  so shortcuts work on the first interaction.
- Workspace initialization preserves Guides and runbooks created concurrently
  instead of overwriting them or recording an incomplete installation as current.
- Issue document relationships use the target's stored AKB document URI. Issue
  rows continue to store Reef issue IDs.

### Security

- Update the supported Node.js minimum, CI pin, and Docker images to 24.22.1
  for the October 2026 security fixes, including CVE-2026-105482,
  CVE-2026-105483, CVE-2026-106069, and CVE-2026-111497.

### Migration

- Schema v4 is unchanged. Existing exact-v4 installations use an explicit
  no-op schema transition; no issue-row or browser-storage migration is required.
- Vault skill version 24 corrects relationship instructions. Deploy or resume
  with a required release receipt to reinstall managed instructions and repair
  existing document relationships automatically. Keep the same receipt to retry
  failed vaults; verified vaults are skipped. Follow the
  [deployment recovery steps](docs/deployment.md#register-and-deploy) for blocked
  rollouts and partial repairs.

### Operational

- Deploy both runtime images from the same source revision and retain their
  separate immutable digests. Preserve the current CPU, SSO, and SSE settings.
- Roll back both runtimes with the previous release's matching images and
  identity. Older writers can reintroduce raw relationship IDs. After such a
  rollback, redeploy this release and repeat the repair with a new receipt.
  Keep old and corrected writers from running concurrently during repair.

## v0.17.6 - 2026-10-13

### Fixed

- New workspaces complete installation automatically. AKB durably enqueues a
  schema job, and Reef waits for it to become active before initializing
  templates and runbooks. Initialization preserves the seeded Guide's existing
  metadata and body. Blocked installations stay out of Ready.

### Migration

- Requires AKB backend 0.16.2 or later on both API and worker before deploying
  Reef. Schema v4 and vault skill version 23 are unchanged; exact-v4
  installations on 0.17.5 use a no-op transition.

## v0.17.5 - 2026-10-12

### Changed

- Ordinary workspace reads trust AKB's active installation instead of checking
  schemas, templates, and runbooks on each read. Diagnostics, initialization,
  and mutations retain their detailed checks.
- Parallel AKB calls within one SSO request share authentication configuration.
  Each boundary still resolves the current Redis session and refreshes
  credentials when needed.

### Migration

- Schema v4 and vault skill version 23 are unchanged. Exact-v4 installations
  on 0.17.0 through 0.17.4 use no-op transitions.

### Operational

- Preserve existing CPU allocation and verify signed-in issue-list, My Work,
  and Inbox latency. Rolling back to 0.17.4 restores repeated readiness and
  authentication-configuration reads.

## v0.17.4 - 2026-10-12

### Fixed

- SSO requests reuse the Web process's Redis connection instead of opening and
  closing a connection at every AKB credential boundary. Session, revocation,
  and credential refresh checks still read current state.

### Migration

- Schema v4 and vault skill version 23 are unchanged. Exact-v4 installations
  on 0.17.0 through 0.17.3 use no-op transitions.

## v0.17.3 - 2026-10-12

### Fixed

- My Work and Inbox avoid inactive installations. System administrators use a
  paginated installation inventory, while ordinary users retain member reads.
- Cross-workspace queries align columns by name, so installations with
  different physical column orders aggregate correctly. My Work timestamps
  and default-view sprint IDs use their declared SQL types.

### Migration

- Schema v4 and vault skill version 23 are unchanged. Exact-v4 installations
  on 0.17.0 through 0.17.2 use no-op transitions.

## v0.17.2 - 2026-10-12

### Fixed

- System administrators can open installed workspaces using the authorized
  installation-detail endpoint. Ordinary members retain the minimal activity
  check; resource permission failures do not sign users out.

### Migration

- Schema v4 and vault skill version 23 are unchanged. Exact-v4 installations
  on 0.17.0 and 0.17.1 use no-op transitions.

## v0.17.1 - 2026-10-12

### Fixed

- Installation checks accept AKB drift responses with release versions encoded
  as strings, restoring workspace access, Settings diagnostics, and processor
  installation checks.

### Migration

- Normalize legacy AKB catalog type aliases `json` and `number` to `jsonb` and
  `numeric` before readiness checks. Logical schemas and physical types remain
  unchanged; Reef runtime paths do not modify schemas.
- Exact-v4 installations on 0.17.0 use a no-op transition. V3 installations
  still require the maintenance procedure in the 0.17.0 entry.

## v0.17.0 - 2026-10-12

### Added

- My Work and Inbox span every ready workspace accessible to the signed-in
  actor. Both retain source-workspace links even when issue ids overlap;
  My Work can filter its queue by workspace, and Inbox has an account-wide
  unread badge. Personal navigation is separate from workspace navigation.
  (REEF-658, REEF-666)
- Markdown references search documents and files in the active workspace.
  Link insertion and `@` suggestions save canonical AKB links alongside people
  and issue references; links verify current access before opening, and files
  download through Reef's authenticated proxy. (REEF-629, REEF-635, REEF-636)
- Issue images support description editing, removal, and replacement.
  Insertion, paste, drop, and replacement share per-file retry, preserve successful
  uploads, and discard unused unclaimed editor assets. Removing a Markdown image
  preserves its AKB resource. (REEF-632, REEF-633)
- Milestones and releases have shareable detail panels with rendered notes,
  linked issue previews, and planning rollups. (REEF-597)

### Changed

- Breaking: AKB owns Reef installation and schema lifecycle. Owners and
  admins explicitly approve installation, restore, and fresh-install commands;
  uninstall retains data. Product and agent requests verify canonical activity,
  required table metadata, and initialized Reef data without modifying schemas.
  Onboarding creates workspaces, while existing workspace access and Settings
  provide task-specific guidance and administrator diagnostics.
  (REEF-418, REEF-419, REEF-422)
- Breaking: the Event Processor discovers all active Reef installations
  through app-scoped inventory instead of a configured single vault. It keeps
  the last verified worker set through inventory failures and reconciles each
  installation independently. (REEF-659)
- Large boards virtualize cards within each column, preserving full counts,
  keyboard traversal, drag targets during auto-scroll, and the focused card's
  position after detail close or workspace reentry. (REEF-616, REEF-661)
- Reports use validated server-computed results for aggregates, flow metrics,
  health rollups, pivots, and forecasts instead of loading raw issue and activity
  rows into the browser. (REEF-617)
- Markdown editing uses the shared Source surface, toolbar, and localization.
  Source supports title links and Undo/Redo; draft synchronization and image
  resolution preserve canonical Markdown instead of saving runtime display URLs.
  (REEF-626, REEF-630, REEF-660)

### Fixed

- Participant subscriptions stay synchronized before activity is recorded.
  Issue creates and requester/assignee changes update their source subscriptions;
  new comments and replies add a commenter source. Automatic updates preserve
  explicit manual watch/mute choices. (REEF-659)
- Concurrent SSO requests reuse the completed refresh instead of failing
  immediately while another request refreshes the same session. (REEF-668)
- Search and board refreshes preserve existing results and position. Rapid
  queries retain their matching result sets with one progress indicator; card
  saves no longer trigger whole-board loading, and reorder operations preserve
  neighboring issues' status-change times. (REEF-645, REEF-646, REEF-655, REEF-667)
- Issue details and workspace entry keep their frame through loading and
  navigation. Saved editor dimensions apply immediately, relationship drills
  keep the detail panel mounted, attachment loads do not shift content, and
  sub-issue failures retain known rows with retry. (REEF-648–652)
- Markdown preserves exact mention identities and authored references across
  Source/WYSIWYG changes and save/reload. Code examples remain untouched, image
  filenames escape special characters, and late reference-menu callbacks no
  longer hide descriptions. (REEF-638, REEF-660)
- Workspace favorites survive temporary availability gaps, and current vault
  display names appear in activity and people controls. Saved themes apply before
  first paint. (REEF-643, REEF-653, REEF-664)

### Security

- Patch Next.js and vulnerable transitive image, Markdown, math, HTTP, telemetry,
  and build dependencies reported by GitHub Dependabot.

### Migration

- Schema v4 requires an AKB-managed transition before deploying Reef. It adds
  `UNIQUE (reef_id, event_key)` to `reef_activity` and seven lookup indexes.
  Existing v3 installations have explicit transitions from `0.14.0`, `0.15.0`,
  `0.16.0`, and `0.16.1`, each requiring the exact source fingerprint
  `dada7b10e269e374dde943db7458dee3d5c1b69788778ea0a29169a16924a727`.
  Fresh installs receive complete v4 table descriptors. AKB must expose the
  installation lifecycle, canonical required-table metadata, and rollout APIs;
  Reef no longer repairs or stamps schemas. (REEF-366, REEF-418, REEF-419, REEF-654)
- Event Processor configuration changes: remove
  `REEF_EVENT_PROCESSOR_VAULT`; retain `REEF_EVENT_PROCESSOR_AKB_TOKEN` and add
  the registered Reef app's `REEF_EVENT_PROCESSOR_APP_CREDENTIAL` to its Secret.
  AKB must support app-scoped active-installation inventory, and the app must
  already have `inventory:read`. (REEF-659)
- Refresh existing workspace AI instructions through Settings before agents
  use the new write rules. Vault skill version 23 documents source-specific
  participant subscriptions and conflict-safe activity inserts. Deployment alone
  does not update existing vault documents. (REEF-659, REEF-654)
- Persisted query cache advances to `reef-cache-v7`. The first visit discards
  old cached responses; aggregate personal queues are not persisted. Browser
  preferences and drafts need no data migration. (REEF-658)

### Operational

- Use a maintenance window for the v3→v4 transition. Block Reef access and
  stop both old runtimes before the app-wide AKB rollout; old and new versions
  must not run concurrently. After terminal `applied`, deploy both matching image
  digests and release identities, then verify authenticated Workspace Ready for
  every affected installation before restoring access. Health/readiness probes
  alone do not verify workspace schemas.
- On partial failure, `blocked`, or timeout, keep maintenance in place and
  preserve the job id and applied results. Duplicate activity keys block the
  target without automatic cleanup; the operator must resolve the cause before
  explicitly resuming the same rollout with a new idempotency key. An image-only
  rollback cannot undo an applied schema transition. (REEF-366, REEF-654)
- Keep the processor private, single-replica, and `Recreate`; preserve ingress
  SSE buffering-off and timeout settings. Both runtime digests must match the
  build artifact and receipt; AKB Manifest v2 verifies only the web digest.
- Docker builds now package the processor's production dependency subset when
  the workspace contains web-only Markdown patches. Normal frozen installs
  continue to require every declared patch.
- The release CLI preserves ingress annotation strings through Kubernetes YAML
  decoding, so the SSE buffering-off and timeout settings survive deployment.

## v0.16.1 - 2026-09-28

### Migration

- Add an empty schema transition from v0.16.0. The schema-v3 projection,
  application behavior, and fresh-install plan remain unchanged. (REEF-423)

## v0.16.0 - 2026-09-28

### Changed

- Breaking: notification projection runs in a separate private Event
  Processor. It recovers from Event Gaps, reconciles source state periodically,
  and drains on shutdown. `pnpm dev` starts both processes; `pnpm dev:web`
  starts only the web application. (REEF-583)
- Breaking: cluster deployment requires immutable AKB release registration
  and rollout. The release CLI verifies and registers the Manifest, waits for
  AKB's rollout to reach `applied`, then applies both runtime image digests to
  Kubernetes. Retries reuse verified receipts; blocked rollouts require explicit
  resume. Mutable tags and version/source overrides are no longer deployment
  inputs. (REEF-421)

### Fixed

- Non-admin users can create workspaces and retry partial setup under the
  same name. Ordinary runbooks use `reef/runbooks` instead of the reserved
  `overview` path. Onboarding preserves existing instructions, issues, settings,
  and user documents rather than overwriting a partially initialized workspace.
  (REEF-642)
- Transient auth revalidation no longer signs out an established session.
  Refresh contention, temporary failures, and probe timeouts preserve the
  workspace with a retry action; first visits keep protected content hidden
  until verification succeeds. (REEF-641)
- Ask AI uses the platform-primary Period shortcut. `⌘⇧.` on macOS and
  `Ctrl+Shift+.` on Windows/Linux toggle the panel; shortcut guidance matches
  the action. (REEF-622)

### Migration

- Deploy the Event Processor alongside the web application with
  `AKB_BACKEND_URL`, `REEF_EVENT_PROCESSOR_VAULT`, and the secret
  `REEF_EVENT_PROCESSOR_AKB_TOKEN`. AKB must provide the Change Event stream
  and source reconciliation APIs; cluster deployment additionally requires the
  App Registry and rollout APIs plus an operator-only
  `REEF_CONTROL_PLANE_TOKEN`.
- Refresh existing vault-skill/runbook documents through Settings to install the
  canonical `reef/runbooks` paths. Onboarding preserves older instructions and
  does not stamp them as current. Existing schema-v3 tables and browser storage
  need no schema upgrade or data backfill. The Blueprint includes an explicit
  schema no-op transition from v0.15.0.

### Operational

- Release artifacts bind web and processor images to one source revision.
  Both digests are recorded in the build artifact and receipt. AKB Manifest v2
  verifies only the web digest; processor identity is verified by Reef's receipt
  and Kubernetes readback, outside the AKB manifest/checksum.
- Run the processor as a private single-replica `Recreate` Deployment with
  internal `/healthz`, `/readyz`, and `/metrics` endpoints and no public Service,
  Ingress, or HPA. The CLI checks readiness and runtime identity after apply and
  records release provenance in both PodTemplates.
- Release image archives contain `reef-web:v0.16.0` and
  `reef-event-processor:v0.16.0` plus full source-revision tags. Pin deployments
  to each verified digest. For rollback to v0.15.0, restore its web image and
  deployment configuration and remove the separate processor workload; retain
  AKB cursor and notification state so a later redeploy can reconcile it.

## v0.15.0 - 2026-09-14

### Added

- Timeline planning overlays show sprint bands and milestone/release markers.
  Read-only planning data shares the existing quarter day grid and catalog cache,
  including clipped sprint ranges, release-date precedence, and same-day marker
  stacks with keyboard-accessible details. (REEF-357)
- Planning opens with a combined Overview. The current sprint, unfinished
  milestones, and planned/in-progress releases share stable dates, planning
  statuses, issue rollups, and existing detail links; the complete catalog
  remains available through the List view. (REEF-596)
- Planning can close an active sprint and roll unfinished work into an
  explicitly selected next sprint. The action persists its target and
  per-issue progress so partial failures can be retried without duplicate
  sprint or activity records.

### Changed

- Breaking: authentication now requires AKB's schema-v2 capability catalog
  and one explicit `REEF_AUTH_MODE`. Local mode accepts only the current local
  session contract. SSO mode is now a Reef companion OIDC BFF with PKCE,
  encrypted Redis token custody, refresh locking, back-channel logout, and an
  opaque httpOnly browser handle; the legacy provider-less exchange and token-
  bearing logout paths have been removed. (REEF-623)
- Issue-body Markdown editing now uses the shared AKB editor core and stable
  document attachments. Uploaded images are stored as canonical
  `/api/assets/<uuid>` targets, resolve through authenticated runtime URLs, and
  retain successful items when a mixed upload batch partially fails; existing
  non-image issue attachments and comment uploads keep their current behavior.
  (REEF-593)
- Loading surfaces keep their product chrome visible. App navigation, issue
  scopes and views, detail and settings labels, planning tabs and headers, My
  Work metrics, and report filters and titles remain in place while values load;
  unknown data and permissions stay deferred until queries resolve. Unused
  dialogs and issue views are loaded on demand. (REEF-613, REEF-614)
- Planning view state is URL-owned. The Overview/List switch restores across
  reload and history navigation, while existing `kind`/`detail` links continue
  to open the corresponding List item.

### Fixed

- Active SSO sessions and browser-local workspace preferences survive the
  correct boundaries. Refresh credentials can rotate throughout Reef's fixed
  24-hour session lifetime, and passive expiry preserves same-account workspace,
  My Views, filters, and favorites. Account switches, explicit sign-out, and
  stable account denials still clear them. (REEF-624)
- Reader notification access and permission guidance are restored. Inbox
  reads no longer attempt schema reconciliation, and resource-level AKB 403
  responses remain permission failures without signing out the user.
- Issue search no longer drops characters or flashes empty results during
  debounce and result handoff. Board, List, Backlog, and Timeline retain the
  prior result and expose accessible update progress. (REEF-615)
- Created/updated date filters and timestamp-sorted pagination work across
  every issue view. AKB timestamp bounds and cursors are cast without losing
  date-only semantics, precision, or tie-break ordering. (REEF-619, REEF-620)
- Interrupted sprint rollovers resume safely with clearer validation and
  conflict guidance. Persisted targets are reused and partial retries do not
  create duplicate sprint or activity records.

### Migration

- SSO deployments require a coordinated companion-client cutover. Configure
  `REEF_AUTH_MODE=sso`, the public issuer and private transport URL, companion
  client id, AKB audience, authenticated Redis, an independent AES-256-GCM key,
  and a fresh `REEF_AUTH_SESSION_NAMESPACE`. Existing legacy SSO cookies and
  encrypted records are not migrated; local deployments must explicitly set
  `REEF_AUTH_MODE=local`.
- Existing Reef vaults reuse the current `reef_sprints.meta` JSON envelope; no
  table migration is required. Refresh the installed vault-skill documents
  before generic AKB agents perform sprint rollover.

### Operational

- Kubernetes readiness now uses `/api/readyz`. In SSO mode it checks the
  configured auth contract, Redis reachability, and pinned JWKS; `/api/healthz`
  remains the liveness endpoint. The container build now installs and builds
  from the full source tree so Git-hosted workspace dependencies can prepare.
- The AKB Document Attachment API is now a runtime prerequisite for issue
  body image uploads. Deploy the AKB asset upload, metadata, discard, copy,
  policy, and stable-byte routes before enabling this Reef revision.
- Publish `reef-web:v0.15.0` and the release commit SHA with an immutable digest.
  Rollback to v0.14.1 in SSO mode also requires restoring its previous AKB and
  authentication configuration; v0.15.0 Redis session records are not consumed
  by the earlier release.

## v0.14.1 - 2026-09-04

### Fixed

- Remove the reserved current-sprint width introduced in v0.14.0. The
  Issues header uses the sprint name's natural width and leaves no empty slot
  when a current sprint is unavailable. Existing long-name truncation and
  responsive wrapping remain in place.

### Migration

- No storage migration or configuration change is required.

### Operational

- Deploy `reef-web:v0.14.1` or its release commit tag, pinned to the verified
  image digest. Rolling back to v0.14.0 restores the known spacing regression.

## v0.14.0 - 2026-09-04

### Added

- My Views save complete issue-view preferences in the browser. Named
  views capture filters, scope, layout, grouping, ordering, display options,
  and List columns for each account and workspace.
- Issue filters support date ranges and unset values. Filter by updated,
  created, start, or due date, and find issues without priority, severity,
  due date, or an assignee. Filters work across Board, List, and Backlog and
  persist in URLs and My Views; date criteria use the shared accessible Select.
- Sprint detail pages show progress, health, goals, and scoped Board/List
  views. Open them from Planning or the current-sprint shortcut in the
  shared Issues header.
- Planning shows progress and capacity across sprints, milestones, and
  releases. Review issue counts, completion, estimated/completed points,
  unestimated work, and sprint capacity, then open the corresponding Issues view.

### Changed

- Issues share planning and display controls across layouts. The current
  sprint appears in the Active header, and Active List columns move into
  Display while retaining URL and My View persistence.
- Typography, focus, selection, and cursors are consistent across the UI.
  Shared text roles preserve the established heading and compact-control
  hierarchy, with Inter, Noto Sans KR, and Geist Mono for mixed-script text.
  Visible teal focus indicators and state-aware cursors clarify keyboard,
  editing, disabled, and drag interactions.
- SSO login copy no longer assumes a particular identity provider.
- Breaking: Reef table artifacts require AKB's canonical `numeric` and
  `jsonb` types. Schema manifests and table mutations no longer accept the
  obsolete `number` and `json` aliases.
- `@reef/core` supports commit-pinned pnpm Git dependencies. Consumers can
  install the `packages/core` subdirectory as a built ESM package. Obsolete
  private execution packages have been removed from the workspace.

### Fixed

- Quick edits and manual reordering show saving, saved, and failed states
  on the affected field, row, or card. Failed writes retain rollback and
  retry feedback, and closing a quick editor restores keyboard focus.
- Planning read failures no longer appear as empty lists or zero progress.
  Errors provide retry actions, and editor dialogs keep Save and Cancel
  visible in short windows.
- Current-user avatars retain their account color across surfaces.
- Monitored-repository selectors retain focus while saving.
- The Issues header stays the same height while the current sprint loads
  or is removed. Its shortcut reserves space before planning data arrives.

### Migration

- My Views replace legacy saved filters. Existing saved filters are not
  read or migrated; recreate them as My Views. My Views and date ranges use
  the existing IndexedDB `config` store, so no browser schema upgrade is needed.
- Release artifacts describe the existing schema-v3 installation. Update
  external table-artifact producers to emit `numeric`/`jsonb`. This release
  adds no storage schema version or data backfill; its Blueprint contains a
  fresh-install plan, not an upgrade plan for older installations.

### Operational

- Release Blueprint and Manifest v2 make release provenance verifiable.
  Validate the committed Blueprint against Core, then finalize and verify the
  payload with version, full source revision, and immutable OCI image digest
  before registry submission.
- Docker builds defer install scripts until source is available. Core's
  Git-consumer preparation no longer fails in the manifest-only dependency stage.
- The private Event Processor can project notifications from AKB Change
  Events. Its deployment host must run the processor with authenticated
  access to the vault's `table.rows_changed` stream. It is a separate process
  from reef-web and retries interrupted streams and projection failures.
- Merge queue CI reuses successful PR checks for unchanged trees. Changed
  bases or grouped trees run full validation. Live AKB contract coverage now
  includes data-plane, authentication, and installation boundaries.
- Publish `reef-web:v0.14.0` and the release commit SHA with an immutable
  digest. Roll back reef-web by selecting the v0.13.0 image with the same
  deployment environment; stop the new Event Processor separately if enabled.
  Browser My Views are local preferences and are not converted to legacy
  saved filters on rollback.

## v0.13.0 - 2026-08-31

### Added

- Reports now include Cycle Time and Lead Time flow metrics. The Reports
  page shows measurement coverage, P50/P85/P95 percentiles, P85 SLE, completion
  distributions, outliers, and clear empty or low-sample states for the selected
  window.

- Manual ordering is now shared across Issue Board and List views. The
  server-owned rank remains consistent across Active and Backlog workflows,
  filtering, pagination, and grouping, while new issues stay at the
  manual-order tail.

- Active Issue Board and List can now group work by Epic. Root Epic headers
  show status and visible child progress, direct children preserve the current
  filter/sort order, and missing or unsupported parents use localized fallback
  groups. Epic grouping is read-only for Board drag interactions and shareable
  through `group=epic`.

- The sidebar workspace switcher now supports account-local Favorites.
  Favorites persist per account in the existing browser store without taking
  ownership of URL workspace identity.

- Issue List and Board sorting now supports numeric ticket numbers. Numeric
  ticket ordering is consistent across shared controls, keyset pages, and
  client-rendered views, including non-padded numbers and gaps; locale-aware
  title ordering and missing-date placement stay aligned across server and UI.

### Changed

- Breaking: Active/Backlog scope is now separate from Board/List/Timeline
  layout. Backlog has dedicated Priority Board and Rank-ordered List views,
  both axes are shareable through URL and browser history, and the old
  `view=backlog` path is removed. Scope and layout controls remain in stable
  header areas when switching.

- Breaking: Reef now accepts only the provider-neutral `REEF_LLM_*`
  deployment contract. `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL` are no
  longer read or validated; deployments must provide
  `REEF_LLM_API_KEY`, `REEF_LLM_BASE_URL`, and `REEF_LLM_MODEL` together.

- Breaking: removed unused agent review and prompt surfaces. The uncalled
  agent-artifact approve/edit/dismiss API, issue/status proposal schemas,
  Tauri-era ProjectState prompt, and legacy `/api/enrich` endpoint are gone.
  New Issue enrichment now uses the same `/api/agents/runs` SSE contract as Ask
  AI, backed by a direct enrichment pipeline and a small shared lifecycle event
  emitter.

### Fixed

- Authentication revalidation and soft navigation now preserve the
  established workspace experience. Route changes stay non-blocking, the
  shell remains mounted while revalidation completes, and a resource-level
  workspace 403 no longer clears a valid session or causes a false logout.

- Manual issue reordering now keeps its related updates consistent. Assignee
  moves synchronize automatic subscriptions, group changes refresh Activity,
  timestamp-guarded writes no longer fail at the AKB SQL boundary, and stale
  conflicts present the latest order for a fresh retry.

### Security

- Breaking: AKB SQL value handling is now parameterized across Reef's core
  paths. Dynamic values use `runSql` positional parameters or typed AKB
  request bodies; manual value-quoting helpers and the public `akbQuoteText`
  export are removed. `quoteIdent` and `tableRef` remain available for
  identifiers.

### Migration

- AI-enabled deployments must migrate to the provider-neutral environment
  variables before rollout. Set `REEF_LLM_API_KEY`, `REEF_LLM_BASE_URL`, and
  `REEF_LLM_MODEL` together; Reef no longer reads `OPENROUTER_API_KEY` or
  `OPENROUTER_BASE_URL`. To roll back to v0.12.0, restore the legacy variables
  before starting the old image.

- No manual browser-storage migration is required. Favorites use the
  existing IndexedDB `config` store, and account or session invalidation removes
  empty persisted query snapshots while preserving non-empty snapshots.

### Operational

- Publish immutable release image references alongside the convenience tag.
  Use `reef-web:v0.13.0` and the release commit SHA for deployment and
  provenance; `latest` must not be the only deployable reference.

## v0.12.0 - 2026-08-24

### Added

- Issue Description edits now appear in the Activity timeline with the
  editor and timestamp, while repeated body updates collapse into an expandable
  group.

- Issue status saves now expose per-issue pending state. List, Board, and
  detail surfaces keep unrelated issues interactive while a save is in flight,
  and shared async actions provide clearer progress and failure feedback.

### Changed

- Breaking: removed the obsolete AI activity-scanning and Suggestions
  vertical slice from MVP. The Suggestions and activity-scan pages, routes,
  APIs, task, prompts, scan persistence, workspace setting, browser target and
  watermark state, and generated runbooks are gone. Existing legacy AKB rows
  and documents are left untouched; fresh workspaces no longer create them.
  Dexie/IndexedDB no longer reads or writes the removed activity target and
  watermark keys; existing browser values remain inert and require no destructive
  migration.
  On-demand Ask AI, issue enrichment, monitored-repository read-only grounding,
  Notification Inbox, issue Activity, implementation references, and inline
  client-ephemeral field-suggestion review remain available.

- Removed the vault-less dashboard compatibility routes. Dashboard links now
  require the canonical `/workspace/{vault}/...` form; old flat paths such as
  `/issues`, `/planning`, and `/settings/...` no longer redirect through the
  remembered workspace.

- Workspace SSO once again delegates browser login and the one-time code
  exchange to AKB. Reef stores the resulting AKB-issued JWT in its httpOnly
  session cookie and no longer treats a Keycloak access token as an AKB API
  credential or requires Redis-backed OIDC token custody. The login page remains
  hybrid whenever AKB enables both local authentication and Keycloak.

- Issue creation and detail Description editors now share an accessible,
  fine-pointer height grip and a 320px initial frame. Pointer and keyboard
  changes use the existing 200px-to-viewport clamp, WYSIWYG and Source share
  the frame, and the current tab restores one shared session height. A
  maximized create shell may supply a transient preferred height without
  persisting it; direct user input takes precedence. Other MarkdownEditor
  consumers remain opt-out, and narrow/coarse-pointer layouts keep their
  automatic behavior.

- New Issue now offers a desktop-only two-dimensional maximize/restore
  toggle. The create canvas grows from the 1200px default to a capped 1680px
  width and `100dvh - 2rem` height when either axis has at least 32px to gain;
  the Description editor receives only a transient preferred height, while
  REEF-545's persisted user height remains authoritative. The toggle keeps
  draft values, focus, and body scrolling intact, restores within the same
  tab, and stays separate from Issue Detail's shell state.

- Issue sorting now lives in the shared filter toolbar, keeping search,
  facets, grouping, and ordering controls in one predictable place across List
  and Backlog workflows.

- Dashboard surfaces now use semantic background, border, overlay, and
  interactive roles across light and dark themes. Mobile issue, My Work, and
  Settings layouts also contain long content and expose clearer keyboard and
  screen-reader feedback.

### Migration

- SSO deployments must remove Reef-owned OIDC and Redis session
  configuration. Reef no longer reads `REEF_AUTH_MODE`,
  `REEF_KEYCLOAK_ISSUER`, `REEF_KEYCLOAK_TRANSPORT_URL`,
  `REEF_KEYCLOAK_CLIENT_ID`, `REEF_AKB_API_AUDIENCE`,
  `REEF_SESSION_REDIS_URL`, or `REEF_SESSION_ENCRYPTION_KEY`. Configure SSO in
  AKB, keep `AKB_BACKEND_URL`, and set `REEF_PUBLIC_ORIGIN` when Reef and AKB
  use distinct public origins. A hybrid AKB may optionally set
  `REEF_SSO_AUTO_REDIRECT=1` for SSO-first presentation.

- No destructive storage migration is required for removed Suggestions.
  Existing AKB activity rows and documents, plus legacy browser target and
  watermark values, remain untouched and inert.

### Operational

- Kubernetes readiness now uses `/api/healthz`. Reef no longer exposes
  dependency-aware Redis/Keycloak readiness because AKB owns SSO and Reef is
  stateless. Remove obsolete `/api/readyz` probes during rollout.

- Rollback to v0.11.0 requires restoring its Reef-owned Keycloak and Redis
  environment before starting the old image. Keep those values available
  until the v0.12.0 SSO login and sign-out smoke test has passed.

### Fixed

- Onboarding now accurately guides new workspace creation. Required name
  and issue-prefix errors plus repository selection state are announced to
  keyboard and screen-reader users, while the repository picker and long
  repository names remain operable within narrow layouts.

- Workspace SSO no longer fails account validation by sending AKB a token
  intended for a different resource server. Both password and SSO login now
  establish the same AKB-issued session contract used by AKB's own frontend.

- Protected soft navigation now verifies the current AKB session before
  rendering authenticated content, preventing stale browser state from
  bypassing the login boundary after expiry or account denial.

- Repeated AKB Markdown document-link normalization is now idempotent, so
  an already normalized link keeps the same href and label across subsequent
  reads and edits.

- Description and issue-detail resize handles remain attached to their
  frames while content scrolls, and shared tooltips stay above dialogs and
  other layered surfaces.

## v0.11.0 - 2026-08-18

### Security

- LLM JSON and activity-content parsing no longer rely on polynomial-time
  regular expressions. Patched `DOMPurify` and `nanoid` versions also address
  known transitive dependency vulnerabilities.

### Added

- Issue create and detail Markdown bodies now share one localized `@` reference
  picker for people, issues, and AKB documents. Person selections stay
  canonical mentions, issue selections insert plain IDs, and document selections
  insert ordinary Markdown links without changing Source mode or issue
  relations.

- Issue Markdown editing now offers a categorized keyboard-first slash block
  menu with localized filtering, basic GFM table insertion, and bounded
  lowlight code highlighting. The menu is editor-bound, clamps or flips at
  narrow widths, and leaves direct REEF-id and relation behaviors unchanged.

- Comment authors can now permanently delete their own comment and every
  reply below it from the Activity timeline after confirmation; the server
  removes matching comment-source notifications in the same cascade.

### Changed

- AKB installation status reads are now scoped to Reef's application context
  and redact credentials and opaque upstream responses.

- Issue-body references now share distinct compact visuals for known issues,
  documents, files, and resolved mentions while ordinary links retain their
  existing styling.

- Issue detail editing now uses a roomier three-step desktop width scale:
  1200px minimum, 1440px default, and 1680px maximum, while still capping the
  panel at 94% of narrower viewports.

- Issue detail Description editing now supports a quiet fine-pointer height
  grip from 1024px upward with pointer capture, keyboard and screen-reader
  controls, shared WYSIWYG / Source sizing, and tab-session restoration.
  Coarse-pointer and narrower layouts omit the focusable grip; Source mode
  keeps its native vertical resize fallback.

- New Issue now keeps its responsive writing flow intact on narrow and
  reduced-height viewports. Header actions reflow without clipping, the
  title/Description column stays ahead of metadata, and only the form body
  scrolls while the Cancel / Create issue footer remains reachable.

- Authentication is now an explicit local-or-SSO deployment choice. Local
  mode preserves AKB-issued JWT cookies. SSO mode uses Keycloak Authorization
  Code + PKCE with encrypted Redis-backed sessions, refresh-credential rotation,
  back-channel logout, and dependency-aware readiness.

### Migration

- SSO deployments must provide `REEF_SESSION_REDIS_URL` and an independent
  32-byte `REEF_SESSION_ENCRYPTION_KEY` before rollout. Local-auth deployments
  require no authentication migration. No browser-storage or AKB schema
  migration is required for this release.

### Operational

- SSO readiness now verifies Redis and Keycloak reachability before serving
  traffic. Confirm both dependencies and the required session variables during
  rollout; local mode does not require these SSO dependencies.

### Fixed

- Sub-issue assignee names now use the same compact body typography as the
  issue titles beside them, preserving the existing avatar, ID, status, and
  priority hierarchy across desktop and narrow layouts.
- Priority selectors now render the unset label with the same typography as
  real priority options while keeping it free of a priority color dot. The
  shared treatment covers List and Backlog quick edit, issue creation, issue
  detail, and bulk edit.
- Issue List assignee quick editors now close on Escape even when focus stays
  on the originating cell trigger, without changing the assignee or issuing a
  save request.
- Issue quick editors now close reliably with Escape immediately after a
  viewport resize, and List context-menu keyboard coverage no longer races a
  preceding pointer menu's focus restoration.
- Issue detail assignee selection now exposes every assignable writer, admin,
  and owner with deterministic ordering and recent-success prioritization,
  while preserving long-list keyboard behavior and failed-save rollback.
- Issue-list assignee cells now resolve the current vault display name from
  the stable username, with refresh-on-mount roster revalidation and login
  fallbacks for missing names or members.
- Truncated sub-issue titles now expose the full title on hover and keyboard focus without changing the existing row metadata layout.
- Truncated relation titles and single planning selector values now expose the full value on hover and keyboard focus without changing selection or navigation behavior.
- Issue detail panels can now be resized on desktop with a pointer or
  keyboard splitter, while preserving the width for the current tab session
  and keeping the existing narrow-screen layout.

## v0.10.0 - 2026-08-11

### Added

- Reports true-empty states now expose a filled PageHeader New issue action.
  The action opens the existing shared issue creation dialog while the section
  frame keeps its title-and-description-only geometry.

- A private foreground work-URI invocation adapter now executes the
  provider-bound delivery slice. The built artifact reads and claims one
  work snapshot, provisions a managed workspace, drives the Codex harness,
  validates exact candidate heads with a finite repair budget, and hands a
  validated head to a non-force branch push and draft pull request before
  transitioning successful work to `in_review`. Blocked, failed, and cancelled
  runs keep work in progress without review artifacts while controller-safe
  lifecycle state, bounded progress, and one redacted terminal result remain
  observable.

- A private GitHub SCM provider now implements the provider-neutral
  orchestration contract. Explicit repository bindings cover ref resolution,
  deterministic branch reuse, permission-gated commits, non-force fast-forward
  pushes, and draft pull-request create/reuse. Remote identity mismatches,
  default-branch and tag writes, refspec or force-push attempts, credential
  bearing inputs, and raw Git/GitHub payloads fail closed; existing ready PRs
  remain unchanged.

- Named personal issue filters can save, apply, update, rename, duplicate,
  and delete browser-local facet, display, and sort presets without adding
  user-specific server state.

- Large issue lists now load and render progressively. The List view fetches
  100-issue cursor pages and keeps the DOM virtualized while preserving keyboard
  focus, selection, quick edits, and finite sibling views.
- Comment mentions now use exact-case vault-roster autocomplete, canonical
  escaped tokens, save-time validation, and projection-gated rendering.
  (REEF-452)
- Issue-body mentions now use opt-in editor autocomplete with the canonical
  mention parser, while create/update writes derive current-roster recipients
  into issue metadata and record commit-bound internal deltas without exposing
  them in the user activity timeline. (REEF-453)
- Comment mention notifications now reach recipients independently of issue
  subscriptions, respect self-mention and manual mute controls, and open the
  source comment after the notification is marked read.
- Issue-body mention notifications now use the committed added-recipient
  delta, preserve Inbox state across retries, and open the issue description
  after marking the notification read. (REEF-454)
- Jira comment ADF mentions now reuse the canonical Reef mention serializer.
  Mapped accounts are gated by the exact target-vault member roster, unsafe
  usernames use braced escaping, unresolved accounts remain non-identifying
  placeholders, and apply/rerun readback includes the deduplicated recipient
  projection. (REEF-455)

### Operational

- The repository now has one Node 24 and pnpm toolchain baseline. Shared
  workspace versions are owned by the default pnpm catalog, while CI, Docker,
  and Renovate use the same runtime and package-manager declarations.

- The repository now uses TypeScript 6.0.2 as its compiler baseline.
  TypeScript 7 remains deferred until the TypeScript 7.1 program API is stable
  and the compiler-dependent toolchain publishes compatible peer ranges.

- Next.js web development, production, and E2E entrypoints now use the
  default Turbopack path. The standalone production build contract remains
  unchanged while webpack-only overrides are removed.

- Turbo now owns the workspace task graph and cache contract. Build and
  affected selection discover workspace dependencies from pnpm manifests, CI
  builds one exact-head Next standalone artifact plus the discovered workspace
  dependency build artifacts for all Playwright shards, and Docker prunes
  `@reef/web` before installing and building the runtime image.

### Changed

- Board and List now support shareable issue grouping by Status, Priority,
  Assignee, Sprint, and Label. List grouping includes None buckets and sticky
  collapsible headers inside the existing virtual projection; Board keeps
  nullable-field drops on the optimistic mutation path and makes Label groups
  read-only. Group choices survive view navigation and reload through the URL,
  while collapse remains local UI state. (REEF-341)

- Section empty states now expose one named semantic region from their visible
  title and description. Structure prompts remain unboxed without an unnamed
  landmark, and the same accessible references cover the Board no-match overlay
  while preserving existing CTA, keyboard, responsive, and theme behavior.

- Zod validation now runs on Zod 4 across core, web, the Jira migrator, and
  orchestration. Explicit record key schemas, strict/loose object policies,
  and flattened form/field errors preserve the existing boundary contracts;
  no Zod 3 compatibility path remains. (REEF-487)
- Jira migration now preserves more source fidelity across content, history,
  links, media, and resumes. ADF panels and line endings normalize safely,
  changelog and sprint history map into Reef activity, attachment and linked-issue
  bindings stay bounded and deterministic, and interrupted runs recover a stable
  archive identity.

- Suggestions empty states now explain their actual cause. Unconfigured
  workspaces point to monitored-repository setup, configured passive queues
  keep a separate Check now action, and filtered no-match results offer one
  outline Clear filters control outside the shared section frame. Existing
  pending proposals remain reviewable even when a monitored repository is
  removed.
- Board empty states now distinguish a configured workspace with no matching
  filter results from a truly empty board. The no-match message and
  keyboard-accessible filter reset stay together in a compact non-modal overlay
  inside the board body while all workflow columns, header positions, and
  horizontal scroll context remain visible in both locales. Facet-only and full
  filter resets have distinct accessible labels, and the full recovery clears
  search, facets, sort, and their URL and browser-persisted projections
  together.
- The Markdown editor now uses Tiptap 3.29.2 consistently across its core,
  extension, Markdown, ProseMirror, React, and starter-kit packages while
  preserving the existing Markdown storage and editing contract. (REEF-483)
- Backlog now supports dense multi-selection and bulk issue editing. A
  shared selection column, localized Status/Assignee/Priority/Labels actions,
  semantic issue links, and row-scoped keyboard focus extend the existing
  Backlog reorder and inline-status workflow without exposing Sprint controls.
- Issue rows and Board cards now support keyboard- and pointer-driven context
  menus with inline field editing. Quick editors stay anchored to their field
  triggers while row selection, navigation, and existing action semantics remain
  intact. (REEF-345)
- Empty states now share one canonical section frame across My Work, Inbox,
  Reports, and Planning, while the unconfigured-workspace prompt stays
  deliberately unboxed. The four section frames use the same geometry and
  title/description hierarchy; My Work's empty and caught-up states are passive
  and no longer duplicate Board navigation in the PageHeader, while existing
  Issues/Board navigation, filter reset, and Planning create actions remain
  intact outside the frame.
- Dashboard controls now wait for the shell's client interaction handlers
  before becoming visible or focusable. This keeps first-load navigation,
  planning actions, and narrow-viewport keyboard traversal from losing input
  during hydration.
- List and Backlog issue tables now share compact density and field geometry.
  List opens with the essential fields and offers session-only planning-column
  toggles; Backlog uses the same common field order, keeps Rank guidance in the
  header, and retains its inline status and drag interactions.
- Node package contracts now build and validate from isolated artifacts.
  Seven Node packages use tsdown to emit ESM JavaScript and declarations from
  `dist/`, dependency-cruiser enforces workspace directions and production
  boundaries, and the canonical non-E2E check exercises packed public imports,
  core subpaths, and the Jira migrator CLI.
- Issue filters now converge on shared person and planning option rows.
  Milestone filtering lists only real milestones and exposes a dedicated clear
  action that leaves other active facets intact. (REEF-462)
- Issue filter and action menus now share a keyboard-accessible dropdown
  contract. Display toggles remain open for consecutive changes, saved-filter
  management is grouped under per-filter submenus, and existing account, sort,
  subscription, column, and issue-action callers use the same checked/current,
  focus, alignment, and destructive treatments.

### Security

- Security advisories are patched across runtime and build dependencies. The
  lockfile now pins patched versions of Mermaid, PostCSS, protobufjs, Sharp,
  DOMPurify, linkify-it, brace-expansion, and the Jaeger propagator.

### Migration

- Browser-local named issue filters extend the existing Dexie/IndexedDB `config`
  store in place. The persisted issue-list cache buster advances to v6 and
  discards stale snapshots once on upgrade; no server-side or AKB schema
  migration is required.

### Fixed

- Ask AI now disables Submit until the composer contains non-whitespace
  text. The guard remains effective after closing and reopening the dialog,
  preventing empty requests while preserving the existing send/stop behavior.
  (REEF-488)

- Issue-detail Selects now let a child layer consume Escape before the
  surrounding Sheet handles the next Escape. Selection values, trigger focus,
  and the existing Sheet Back/Close behavior remain unchanged. (REEF-490)

- Issue-detail Close now exits a deep-linked drill session in one action.
  Drilling from a hard-open issue into related issues keeps the original entry
  destination for Close, Escape, and outside-click dismissal while preserving
  the existing Back trail and view/filter/sort query parameters. (REEF-494)

## v0.9.0 - 2026-08-03

### Added

- Added opt-in Jira migration dry-run profiling with aggregate stage and
  Jira/AKB boundary timings, periodic in-flight snapshots, and no impact on
  approval artifacts or migration semantics.

- Global search now includes a bilingual action command mode. The existing
  `⌘K` palette keeps recent issues and metadata/body/comment search intact while
  adding a `>` command mode for vault-scoped navigation, view, New issue,
  theme, locale, and context-aware status/assignee/priority actions. One action
  catalog now drives the palette, global keybindings, and shortcut help, with
  nested keyboard navigation, deliberate focus handoff, same-value no-ops, and
  the existing close-reason workflow.
- Issue detail now exposes actor-scoped Watch and Mute controls. The
  bilingual chrome shows the effective notification state, persists Watch/Mute
  choices through the existing AKB subscription contract, updates
  optimistically with rollback and retryable feedback, and rejects attempts to
  choose another subscriber. (REEF-428)
- Core now provides notification inbox and source-aware issue subscription
  contracts. Public schemas, deterministic keys, recipient-scoped notification
  reads and state transitions, and manual/requester/assignee/commenter
  subscription precedence give follow-up web features a single AKB-backed
  boundary. (REEF-427)
- Global search now finds issue body and comment text. For queries of two
  characters or more, `⌘K` keeps its existing metadata and exact-ID results and
  adds a separate bilingual body/comment group with safe literal highlighting,
  real issue links, quiet degradation, and bounded 10-at-a-time expansion up to
  50 results. (REEF-347)

### Changed

- Batched Jira apply ledger checkpoints by change count and elapsed time while
  preserving forced phase/error flushes, atomic CAS writes, and readback-based
  crash recovery, avoiding thousands of full-ledger rewrites on large runs.

- Global search result groups now use one field/content vocabulary. English
  and Korean palettes distinguish issue-field matches from issue-content
  matches, while body and comment provenance appears as muted inline text
  immediately before each snippet instead of as a branded pill. Existing
  navigation, ranking, deduplication, and command-mode behavior is unchanged.
  The hermetic runtime now exposes health, reset, scenario, and task discovery
  through the repository-owned `dev:e2e` surface. The portable user-behavior
  runner and behavior artifact were removed; canonical checks remain in the
  Playwright specs. (REEF-439, REEF-460)
- Unmatched URLs and recoverable page errors now stay inside Reef's visual
  language. Catalog-backed English and Korean surfaces use the existing teal,
  typography, semantic light/dark tokens, accessible recovery actions, and a
  safe root path without exposing framework or error internals. Theme
  synchronization now also covers routes outside the dashboard shell.
  (REEF-425)
- Activity review is now named Suggestions and has its own navigation
  surface. The workspace sidebar, bilingual page copy, and `G S` shortcut
  open `/workspace/{vault}/suggestions`; the badge reports the full pending
  queue and changes only after approve or dismiss actions. Existing
  workspace-scoped and flat `/activity` links redirect without dropping
  repeated or empty query values, while issue-detail Activity timelines remain
  unchanged. The workspace shell also waits until its controls are interactive
  before exposing them, so early clicks and keyboard shortcuts are not silently
  discarded. (REEF-432)
- The workspace sidebar now includes a persisted Notification Inbox. The
  actor-scoped badge stays within the existing 100-row unread contract, while
  Inbox rows expose read, unread, and archive transitions and deep-link to the
  related issue Activity section without mixing with Suggestions. (REEF-431)

### Fixed

- Jira ADF mentions inside comments now use the reviewed account mapping.
  Comment conversion previously omitted the mapping options already used for
  issue descriptions, causing every comment mention to become the
  non-identifying `@jira-user` fallback even when the Jira account resolved to
  a vault member. Genuinely unmapped accounts still retain that safe fallback.
- Large Jira dry runs no longer reread the same target issue and related-data
  catalogs for every planning pass. Planning reuses its exact issue
  readbacks, serves relation, external-reference, description, and media checks
  from that immutable snapshot, and loads external-reference keys and fallback
  attachment actors with one bulk query per catalog. Missing snapshot data
  still falls back to the existing exact target read.
- Large Jira migration reruns no longer repeatedly scan the complete ledger
  and activity catalog for every entity. The runner builds source-key and
  issue indexes once, reuses each changelog fingerprint, and caches target
  activity readback by issue with explicit invalidation after a write. This
  removes the quadratic lookup and repeated per-history activity-read pattern
  while preserving ordered writes, exact readback, checkpoint, and resume
  behavior.
- Jira issue migrations now preserve the source ticket number. Newly bound
  issues use the target workspace prefix with the Jira key's exact numeric
  segment, so a matching project prefix keeps `SHDEV-290` as `SHDEV-290`
  instead of dense-renumbering it by lexicographic discovery order. Existing
  numeric aliases, collisions, and legacy same-key bindings under a different
  number fail closed, while a genuine Jira key rename retains its stable
  issue-id binding.
- Jira account remapping now repairs migration-owned attachment activity
  actors, including orphaned upload history. An approved account override can
  replace the exact fallback actor on an `attachment_added` event left behind
  when a remapped attachment is revoked and recreated. The repair is
  approval-bound, validates the reserved event shape and previous fallback
  actor, and preserves the event identity and payload.
- Jira account remapping now repairs migration-owned activity in place.
  When a reviewed vault membership or override replaces a fallback Jira actor,
  changelog replay reconciles the existing reserved event key instead of
  attempting an append that cannot change the old actor. Ordinary Reef
  activity remains append-only, while imported assignees and historical actor
  payloads can converge without duplicate events.
- Jira account remapping now repairs migration-owned comment authors in
  place. Imported comments with their exact deterministic Jira idempotency
  key can replace a fallback author after vault membership review while
  preserving comment identity, thread links, and AKB bookkeeping. Ordinary
  Reef comment edits remain author-scoped.
- Jira migration convergence no longer schedules equivalent planning or
  media rewrites. Fresh dry runs recognize the exact native planning UUID
  projection as equivalent to its approval-bound semantic token, and
  descriptions already containing canonical attachment URIs remain no-op
  skips instead of being rewritten to the same value. Related planning also
  uses the issue phase's exact-readback correction before assuming that a stale
  fingerprint will overwrite the base description, and apply accepts the same
  immutable semantic planning projection when its current plan resolves native
  UUIDs.
- Jira migration media and cross-project reconciliation now preserve the
  approved source contract end to end. Issue discovery approval-binds
  rendered fields, description rewrites reuse the issue plan's raw-archive and
  account mapping options, deterministic ADF filename/rendered-element
  crosswalks cover REST attachment hrefs, and mapped out-of-scope issue links
  are distinguished from missing link policy as durable external references.
  Description media placeholders are grounded in their archived ADF object, so
  full-project dry-run and apply no longer conflict on otherwise lossless
  inputs.
- Jira migration apply no longer misclassifies committed AKB writes during a
  short read-after-write consistency window. Planning and issue creation now
  use bounded exact-state readback, issue claims retry their idempotent owner
  reservation, and an ambiguous write error is accepted only when subsequent
  target readback exactly matches the approved issue projection. Planning
  readback also treats an omitted nullable AKB field as the requested `null`,
  so a committed create can be recovered in a fresh resume process. A
  conflicting claim response is also recoverable only when an independent row
  read proves the exact target id, document URI, and Jira owner.
- A deterministic related-entity conflict no longer aborts the entire Jira
  migration process. The failing issue is isolated as a fail-closed conflict
  with a sanitized reason, its confirmed sibling checkpoints remain durable,
  and apply continues classifying the remaining issues.
- Transient AKB read failures no longer create false Jira related-data
  conflicts. Related-data catalog and readback requests retry bounded 429 and
  5xx responses without retrying mutations, and an exhausted transient failure
  remains classified as retryable in the migration report.
- Jira media planning now respects base-issue updates that execute first.
  Related-data dry runs evaluate media rewrites against the approved new issue
  description for both creates and updates, avoiding a false precondition
  failure against stale target content.
- Jira comment approvals no longer depend on target-generated attachment
  URIs. Comment operation fingerprints replace dry-run and live AKB file URIs
  with the same stable Jira attachment identity, while retaining all other body
  and thread-parent differences.
- Jira migration report-only checkpoints no longer rewrite an unchanged
  multi-megabyte ledger. Related and changelog skips retain their existing
  conservation classifications without repeating the private artifact's
  compare-and-swap write, while every binding and durable entity result remains
  atomically checkpointed.
- Jira planning approval no longer conflicts on target-generated ids hidden
  in compact issue provenance. Version and sprint target ids use the same
  source-derived approval token in first-class fields and nested Jira planning
  metadata, so dry-run placeholders and apply-time AKB UUIDs compare
  semantically.
- Jira migration resumes now distinguish target outages from completed
  unbound creates. Bounded AKB transport retries fail the run once at its
  durable checkpoint instead of producing hundreds of entity failures, while
  an existing target with the approved semantic state and exact Jira owner is
  bound before another issue-id claim is attempted.

- Existing users now resume an accessible configured workspace after signing
  in or opening onboarding, without seeing the workspace creation form first.
  Reef preserves a valid last-viewed workspace and otherwise chooses a
  deterministic configured workspace; empty and raw-only accounts still enter
  onboarding, while vault-list failures show a retryable error.

### Migration

- No AKB, API, or browser-storage migration is required for Suggestions. Reef
  continues to use `reef_activity_suggestions`, `_reef/activity-inbox`,
  `/api/activity/suggestions`, and the existing core wire schemas; no copy,
  backfill, Dexie version, or persistence-buster change is needed. (REEF-432)

- Reef storage schema version 2 adds `reef_notifications` and
  `reef_subscriptions` declaratively. New and schema-version-1 vaults create
  only missing tables with their unique keys and lookup indexes; existing Reef
  tables and activity-inbox data are unchanged, no backfill is required, and a
  mismatched existing table fails closed for operator review before any missing
  table is created or altered. Target AKB deployments must support create-time
  `unique_keys` and `indexes`. Reef also rejects vault names that cannot fit
  the longest desired table within AKB's PostgreSQL identifier limit before
  creating any table, preventing a partial workspace installation. (REEF-427)
- Jira vaults created by the migrator before source ticket-number preservation
  must be rebuilt when their stored Jira key and Reef issue number differ.
  The migrator rejects that legacy drift instead of silently retaining or
  renumbering it.

## v0.8.1 - 2026-07-28

### Security

- Next.js is updated from 16.2.6 to 16.2.11. This patch incorporates the
  upstream App Router, Server Actions, rewrites, cache, and Image Optimization
  security fixes published in the 16.2.11 release. (REEF-435)

### Fixed

- Workspace root URLs now land on a usable screen. `/workspace` reuses the
  remembered-workspace/onboarding decision, while `/workspace/{vault}` opens
  that explicit vault's Issues surface without dropping single, repeated, or
  empty query values. Malformed or inaccessible vault roots keep their existing
  denial behavior and cannot silently replace the browser's remembered
  workspace. (REEF-424)
- Jira migration canonical fields and reruns now converge across Jira Cloud
  variants. The migrator reads the target workspace prefix and member roster,
  discovers canonical Rank fields, promotes parent changelog activity, requests
  complete issue projections, supports explicit tenant field overrides, and
  normalizes run-volatile metadata without hiding semantic changes. Separate
  dry-run and apply processes can therefore retain the same approval while
  unchanged writes confirm their ledger bindings. (REEF-437)
- Jira migration apply and fresh-process reruns are hardened end to end.
  Non-Scrum boards, enhanced-JQL cursors, raw-archive batches, request-volatile
  development summaries, attachment reconciliation, and comment-thread UUID
  validation now preserve stable approvals and actionable diagnostics. Issue
  attachments use AKB's presigned upload/confirm and download flows with
  metadata and byte readback, stale bindings are safely replaced, and write
  failures remain visible without exposing source content. (REEF-438)
- Reef workspace and issue ID prefixes now accept Jira-compatible project
  keys. Prefixes still begin with an uppercase ASCII letter, but may now
  contain uppercase letters, digits, and underscores after it, allowing a
  matching target workspace to preserve the source project key during
  migration. Issue detail APIs, relations, global search, chat grounding, the
  `read_issue` tool, and Markdown mention links now use the same contract
  instead of rejecting or overlooking those ids. (REEF-438)

### Migration

- No AKB schema migration or data backfill is required. Jira-compatible project
  prefixes are an additive validation change; existing workspace prefixes and
  issue ids remain valid.

### Operational

- Kubernetes rollout history now records deployment provenance. The deploy
  helper derives a change-cause from the root product version and current Git
  commit before restarting the Deployment, with explicit version, commit, and
  complete-message overrides for operators. (REEF-436)
- No Docker Hub image is published for v0.8.1. This patch is distributed by
  source and the annotated `v0.8.1` Git tag. Build and size verification still
  apply locally; rollback uses the immutable `v0.8.0` tag.

## v0.8.0 - 2026-07-27

### Added

- The Jira migrator now has an end-to-end operator CLI. Multi-project
  enhanced-JQL and explicit-board reads feed planning-first dry runs, private
  raw/account/ledger/report artifacts, approval-bound apply, per-entity
  write/readback checkpoints, fresh-process resume, related/changelog
  reconciliation, and deterministic sanitized conservation reports. A built
  ALPHA/BETA HTTP contract proves dry-run target mutation zero, Jira GET-only
  traffic, cross-project relation stability, plan-hash enforcement, duplicate
  zero on rerun, and secret redaction. Related writes and deletions are sealed
  by source-identity-preserving hashed operation manifests, so redirected
  mutations fail before target I/O while completed resume operations converge
  by readback. Attachment revocation is retry-safe across file-delete failures,
  cached downloads retain their byte limits, and unverifiable Windows archive
  ACLs fail closed.
  (REEF-321)

- Jira migrations preserve issue discussion and related artifacts. The
  operator package now exposes a dry-run/apply stage for root-first threaded
  comments, redirect-safe attachment downloads, deterministic ADF media
  rewrites, configured directional or symmetric issue links, separately
  modeled remote links, isolated failures, and readback-confirmed idempotent
  reruns. Role/group-restricted and Jira Service Management internal comments,
  plus attachments whose comment-level visibility cannot be explicitly
  attested complete, are isolated rather than published without their Jira
  access controls; reruns revoke already-imported comments and attachment bytes
  when visibility becomes unsafe, replace revoked file references with a stable
  recoverable projection, and update edited Jira comments in place. Attachment
  buffering is bounded by an operator-set byte limit in dry-run and apply, with
  an explicit 256 MiB safety ceiling and single-buffer streaming growth.
  Legacy ADF media projections remain eligible for option-aware reconciliation,
  so no AKB schema migration or backfill is required. (REEF-320)

- Jira changelog histories can be planned as auditable Reef activity. The
  migrator now verifies pre-normalization raw-history references, classifies
  every item without fuzzy or lossy promotion, reuses planning/link/attachment
  bindings, and emits deterministic replay-safe activity keys and conservative
  reports. Reef activity schemas and the bilingual timeline also support
  lossless issue-type and start-date changes. (REEF-392)
- Jira migration reruns now have a durable local identity ledger and
  checkpoint. The operator package persists Cloud-scoped stable source-to-
  target bindings only after identity readback, resumes by phase and canonical
  entity key, derives multi-project reports from run state, and rejects corrupt,
  scope-drifted, locked, stale-writer, or secret-bearing artifacts through
  compare-and-swap guarded private atomic file I/O. (REEF-319)
- Jira issues can be mapped into immutable Reef import plans. The operator
  package now resolves tenant fields without fuzzy defaults, converts ADF to
  Markdown with explicit unsupported/media evidence, and combines configurable
  enum, account, planning, parent, and Rank mappings into runtime-validated,
  raw-reference-backed plans without performing writes. (REEF-318)
- AKB table schema changes are available through the core adapter. Operators
  can call low-level table alters or caller-keyed idempotent migrations through
  validated public helpers. No vault schema is changed automatically; target
  AKB deployments must provide the table alter and migration endpoints.
  (REEF-055)
- Jira migrations can preserve verifiable raw source artifacts. The
  operator package now separates pre-validation Jira JSON from normalized
  models and exposes a content-addressed, versioned raw archive with integrity,
  retention, secret, and private-permission checks. (REEF-406)
- Reef uses one provider-neutral LLM endpoint contract. Deployments set
  `REEF_LLM_API_KEY`, `REEF_LLM_BASE_URL`, and `REEF_LLM_MODEL` together for
  either OpenRouter or an akb-platform gateway, without a mode switch or
  provider-specific runtime behavior.
  Every model step uses Chat Completions, a UUID request identity, and zero SDK
  retries. LLM availability remains independent from AKB and Keycloak, so
  Keycloak-only deployments stay healthy with AI disabled. (REEF-413)
- AKB account state now survives every Reef sign-in path. Membership-required,
  suspended-account, and identity-conflict responses have stable local and SSO
  UX. AKB's SSO-only/local-auth policy controls the login surface, and an account
  rejection clears established Reef cookies plus account-scoped browser caches
  without treating an ordinary permission denial as a sign-out.
- Comment replies now stay in readable threads. Comments can reply to a
  root or another reply while the activity timeline keeps one visual depth,
  direct-parent context, stable reply ordering, and the root's global timeline
  position. (REEF-065)
- Select and edit multiple issues together in List. List rows now expose
  keyboard-accessible checkboxes, Shift+Click range selection, and an integrated
  toolbar for status, assignee, priority, sprint, and label changes. Board stays
  focused on drag-and-scan work; bulk editing remains available after switching
  to List. Updates reuse the existing single-issue save path sequentially,
  preserve successful items when one fails, and keep failed items selected for
  recovery. Selection controls use full labeled hit targets, while the bounded
  failure tray retries transient failures and removes stale not-found items
  cleanly. (REEF-339, epic REEF-330)

### Changed

- Breaking (internal): the Jira migrator now has explicit module boundaries.
  Jira wire models, migration execution state, raw-archive security, issue
  planning, and related-data import stages now have separate owners behind the
  unchanged `@reef/jira-migrator` root import. Undocumented low-level object,
  redaction, canonical-JSON, and related-reconciliation helpers are no longer
  re-exported from the package root; internal consumers importing those helpers
  must move to the owning module.

### Fixed

- Production web builds stay browser-compatible. Core adapter equality
  checks no longer pull the Node-only `node:util` module into client bundles.

- Comment threads revalidate after a hard reload. A fresh persisted browser
  cache can render immediately, but the activity timeline now always reconciles
  it with the server so recently posted replies cannot disappear temporarily.

- Jira migration artifacts and configuration now reject additional credential
  exposure paths. Raw archives reject symlinks in every existing path
  component, account-mapping artifacts are written with private file modes,
  Jira base URLs cannot contain embedded credentials, and report redaction
  removes configured secrets from object keys before JSON escaping.

### Migration

- AKB table evolution now has an explicit operator-owned rollout policy.
  New-table provisioning remains limited to `ensureReefTables` create/verify,
  while a release pre-start gate must enumerate every registered Reef workspace,
  apply pending caller-keyed `akbApplyTableMigration` phases, and finish with
  manifest/version verification before Reef can become ready. Kubernetes uses
  an identity-isolating initContainer with `Recreate` until mixed-version
  compatibility is proven; local `pnpm dev` runs the same gate once before
  Next.js without passing its migration credential to the long-running process.
  REEF-367 owns the service identity and inventory prerequisites, and REEF-414
  owns the runner and deployment/development wiring. This documentation-only
  change adds no runner, credential, manifest, package script, schema migration,
  data backfill, or `REEF_SCHEMA_VERSION` bump. (REEF-030)
- Update the Reef workspace skill/runbooks to version 17. The comment
  contract now documents `parent_comment_id` / `thread_root_id`, atomic reply
  validation, malformed-chain handling, and trusted importer handoff. Existing
  workspaces should use the normal skill-update prompt before generic AKB agents
  create replies. No AKB table migration or data backfill is required because
  both fields live in the existing `reef_comments.meta` JSON.

### Operational

- No Docker Hub image is published for v0.8.0. This cut is distributed by
  source and the annotated `v0.8.0` Git tag. Build and size verification still
  apply locally. Deployments should build from the immutable tag; rollback uses
  the previous `v0.7.0` tag and the compatibility window documented in the
  migration notes above.

## v0.7.0 - 2026-07-10

### Added

- Grounded, transparent Ask AI. Ask AI now uses the current workspace and
  issue as context, shows tool-call progress, links cited Reef issues, and
  exposes document sources so answers can be checked against workspace data.
  (REEF-337, REEF-360, REEF-361)
- Issue attachments and richer document links. Issue descriptions and
  comments accept uploads from the toolbar, paste, and drag-and-drop. Images
  render inline, other files remain downloadable, and bare AKB document URIs
  become readable title links. (REEF-349, REEF-395, REEF-401)
- Faster issue creation and triage. The issue detail and create flows now use
  a details-first property rail, support creating multiple inherited sub-issues,
  and show advisory similar-issue matches while drafting. (REEF-352, REEF-353,
  REEF-375)
- Keyboard-first issue navigation. Lists and boards support roving keyboard
  focus, direct field-edit shortcuts, view navigation chords, and consistent
  loading feedback across server-backed searches. (REEF-344, REEF-369)
- More ways to share and connect work. Issues can be copied as direct links,
  and external references now support Jira and Confluence alongside the existing
  providers. (REEF-328, REEF-329)

### Changed

- Jira import ordering is preserved in Reef. Trusted migration plans can map
  Jira Rank into Reef's issue-wide numeric ordering, and the Kanban board uses
  that ordering when no explicit user sort overrides it. (REEF-393)
- AKB compatibility is more tolerant. Reef accepts both the legacy and newer
  structured AKB error envelopes when handling not-yet-provisioned workspaces.
  (REEF-363)

### Fixed

- Attachment tables provision reliably. Reef no longer attempts to create
  AKB-managed timestamp columns and recognizes AKB's canonical numeric and JSONB
  type names during schema verification. (REEF-404)
- Markdown and AKB links behave consistently. Rendered issue-body links open
  without moving the editor selection, and deployed document backlinks resolve
  the AKB web URL at request time. (REEF-368, REEF-400)
- Planning views render stable, accurate state. Cached planning data no
  longer causes a hydration mismatch, and sprint, milestone, and release badges
  use planning-specific status semantics. (REEF-396, REEF-398)

### Migration

- Update the Reef workspace skill/runbooks to version 16. The update adds
  portable issue-body link rules, importer-owned rank guidance, Jira and
  Confluence external-reference types, and the attachment table contract.
  Existing workspaces surface the normal skill-update prompt.
- Prefer `AKB_WEB_URL` for deployed AKB backlinks. The URL is now read from
  server runtime configuration. `NEXT_PUBLIC_AKB_WEB_URL` remains supported for
  compatibility, so no immediate environment migration or data backfill is
  required.

### Operational

- Jira migration tooling is now a separate private package. The read-only
  operator package covers Jira payload retrieval and redaction, account mapping,
  Rank mapping, and deterministic Version/Sprint planning contracts. It does not
  yet perform the final issue import. (REEF-311, REEF-317, REEF-391, REEF-402)
- Background orchestration has a separate runtime package. The new private
  package provides configuration, dry-run startup checks, an idle loop,
  graceful shutdown, and a boundary that keeps long-running workers out of the
  web process. (REEF-379)
- Breaking: the legacy `/api/chat` endpoint has been removed. Ask AI
  streaming now uses `POST /api/agents/runs` with
  `task_id: "chat.workspace"`; proxies must keep SSE buffering disabled.
  (REEF-371)
- Development and container installs use pnpm 11.10.0.
- No Docker Hub image is published for v0.7.0. This cut is distributed by
  source and Git tag; local image build verification remains part of the release
  gate.

## v0.6.1 - 2026-07-02

### Added

- Delete a workspace from Settings. The workspace owner now has a "Danger
  zone" at the foot of Settings › Workspace with two ways to clear out a
  workspace that was created by mistake or is no longer used. Remove reef
  deletes reef's issues, planning, activity, comments, and templates while
  leaving the underlying akb vault and any non-reef documents untouched — useful
  when reef was added to a vault your team still uses for other things; you can
  set reef up there again later. Delete workspace permanently removes the
  entire vault, including every document, file, and its history, and asks you to
  type the workspace name to confirm because it cannot be undone. Both actions
  are visible only to the workspace owner; after either one, reef switches you to
  another workspace you can access, or to onboarding if none remain. The action,
  who ran it, and the target workspace are written to the server audit log before
  it runs (REEF-322, epic REEF-001).

### Changed

- The workspace you're viewing now lives in the URL. Every in-app screen is
  now addressed as `/workspace/{workspace}/…` (for example
  `/workspace/reef-acme/issues` or `/workspace/reef-acme/issues/REEF-101`)
  instead of the old flat `/issues`, `/planning`, `/settings/…` paths. Three
  things this fixes: a link you paste into Slack or email opens in the workspace
  you meant — not whatever the recipient happened to have selected; two browser
  tabs can show two different workspaces at once without fighting over a single
  shared pointer; and switching workspaces deep-links straight to that
  workspace's board. The previously-selected workspace is remembered as your
  per-browser default, so opening reef at the root still drops you on your last
  workspace. Old links keep working: a bookmarked or shared `/issues/REEF-101`
  (any old flat path) redirects to its `/workspace/{default}/…` equivalent,
  preserving the query string; if you have no remembered workspace yet it sends
  you to onboarding. Opening a `/workspace/{workspace}/…` link for a workspace you
  are not a member of shows an explicit "no access" screen with your own
  workspaces to switch to, rather than silently falling back (REEF-315, epic
  REEF-001). Operational note: this is a client-side route change only — the BFF
  still receives the workspace via the existing `?vault=` / `X-Reef-Vault` /
  request-body channels, so there is no API, session-cookie, or persistence
  change.

- Editing an issue re-requests fewer list views. When you change a field on
  an issue (status, priority, assignee, sprint, …), reef now refetches only the
  saved list/board views that field can actually affect, instead of every open
  list view. The edit still appears immediately everywhere — the change is
  written into every cached view in place — so this only trims redundant
  background `/api/issues` requests, reducing server and akb load on busy boards.
  No behavior or data change (REEF-323).

- The landing issue list loads faster. Opening reef on your default issue
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

- Sorted issue lists stay in true order after any edit. A saved list sorted
  by "Recently updated" (or by due date, title, or estimate) now refreshes from
  the server after you edit an issue's title, labels, due date, estimate, parent,
  or relations — previously only status/priority-class edits refreshed those
  views, so the saved ordering of those lists could drift out of sync with the
  server (most visibly while several people edit the same board at once) until the
  next reload. Your own edit still appears instantly, and the fix folds the two
  refetch paths into one order-aware rule, so a single edit only re-requests the
  views it can actually reorder — not every open list (REEF-325, follow-up to
  REEF-323, epic REEF-002).

- No more board flicker / console error when reopening a workspace. After
  the move to workspace URLs, hard-reloading or deep-linking an issues view
  (board, list, timeline, backlog, reports, My Work) could momentarily render
  the cached issues against the server's loading skeleton, which the browser
  reported as a hydration mismatch and recovered from by re-rendering. The cached
  view is now revealed one beat after the page mounts so the first paint matches
  what the server sent — the recoverable error and its flash are gone, and a warm
  cache still paints almost instantly (REEF-327, regression from REEF-315).

## v0.6.0 - 2026-06-26

### Added

- English and Korean interface language selection applies across navigation,
  issue fields, editors, planning, reports, search, toasts, and server errors.
  The choice persists per device and applies from the first server render;
  dates and relative times follow the locale, while identifiers stay unchanged.
  (REEF-291, REEF-292, REEF-293, REEF-294, REEF-297, REEF-298, REEF-299,
  REEF-301, REEF-308, REEF-309)
- Workspace admins can enable AI activity scanning in Settings. Scanning is off
  by default for both new and existing workspaces. (REEF-313)
- Monitored-repository selection, activity scans, Ask AI, enrichment, and agent
  grounding use deployment-managed GitHub credentials. Repo listing and scans
  report unavailability; AI answers can continue with AKB context alone.
  (REEF-239, REEF-240, REEF-243, REEF-244)
- Workspace admins can set when completed and canceled issues leave default
  views, with defaults of 28 and 7 days. Display controls reveal completed and
  archived issues through shareable URL state. (REEF-275, REEF-278)
- Parent, sub-issue, dependency, blocking, and related-issue links support
  in-place detail navigation with a Back trail and one-action Close. The header
  stays visible while details load. (REEF-266, REEF-268, REEF-270, REEF-279,
  REEF-284, REEF-286)
- Assignee, Requester, Sprint, and Release filters accept several values and
  match exact logins. Selections persist in the URL. (REEF-267)
- The issue activity timeline displays assignee, priority, and planning changes
  and records title, labels, due date, estimate, parent, relationships, and
  archive changes. Changes from one save share a timestamp. (REEF-276, REEF-277)
- The sidebar flags outdated workspace instructions and links the displayed
  version to its GitHub release notes. (REEF-170, REEF-257)

### Changed

- Breaking: remove browser GitHub PAT collection, storage, and forwarding.
  GitHub access requires deployment-managed credentials. (REEF-244)
- New workspace templates align with Epic, Story, Task, Bug, Spike, and Chore.
  Existing templates remain unchanged. (REEF-256)
- Planning row names toggle their details with keyboard support. (REEF-264)
- View toggles, relationship chips, activity entries, and shared empty states
  use consistent focus and screen-reader behavior. Internal links use client
  navigation, and Reports identifies its active workspace. (REEF-259,
  REEF-260, REEF-261, REEF-262, REEF-281, REEF-282, REEF-287)

### Fixed

- Malformed optional delivery or external references no longer hide an otherwise
  valid issue. Invalid entries are omitted with a backend warning.
- Activity scans reject repositories outside the workspace's monitored set.
  (REEF-289)
- Escape dismisses the open picker before its issue or planning editor.
  (REEF-288)
- Related-issue titles remain readable in narrow panels, and parent breadcrumbs
  avoid flashing raw IDs during loading. (REEF-283, REEF-285)
- Switching issue views preserves the current view until the next is ready.
  Loading placeholders match content dimensions. (REEF-258, REEF-265)
- Signing out clears account caches in other open tabs. (REEF-106)
- Close-reason selections render on one aligned line. (REEF-272)
- External-link confirmations in AI answers and comments no longer cause a
  hydration error that blanks content. (#104)

### Security

- Pin DOMPurify to 3.4.11 for GHSA-cmwh-pvxp-8882. (#40)

### Migration

- Vault skill version 14 adds the expanded activity event contract. Existing
  vaults must reinstall managed instructions from Settings before agents rely
  on those events. (REEF-276, REEF-277)
- Dexie v11 drops the browser `credentials` store, removing access to previously
  stored GitHub tokens automatically. (REEF-244)

### Operational

- Configure `REEF_GITHUB_APP_ID`, `REEF_GITHUB_APP_INSTALLATION_ID`, and
  `REEF_GITHUB_APP_PRIVATE_KEY` for GitHub grounding. A read-only
  `REEF_GITHUB_PAT` is supported for local development and CI when no App is
  configured. (REEF-238, REEF-290)
- `REEF_SSO_AUTO_REDIRECT=1` enables direct SSO entry when AKB reports Keycloak
  enabled. Error redirects do not loop, and `/login?password=1` remains
  available. Unset retains the login panel. (REEF-312)
- `REEF_RESPONSE_LOG=1` enables stdout request and upstream diagnostics, token
  usage, and scan progress. `REEF_SLOW_REQUEST_MS` defaults to 1000. Logs
  exclude credentials. (REEF-271)

## v0.5.0 - 2026-06-19

### Added

- Issues have editable Markdown comments and a unified chronological activity
  timeline. Immutable events record status, assignee, priority, planning links,
  and delivery references with actor and timestamp. Existing issue metadata
  supplies creation, delivery, and closure history without a backfill.
  (REEF-062, REEF-063, REEF-064, REEF-126)
- My Work shows assigned issues, urgency and sprint summaries, a focus-sorted
  queue, status grouping, and a sidebar attention badge. (REEF-181, REEF-204)
- Workspace owners and admins can search existing AKB users, add members,
  change roles, and remove members in Settings. Owners and the acting user
  cannot be removed. (REEF-179)
- Reports adds a Monte Carlo delivery forecast at 50/70/85/95 confidence,
  a categorical pivot, severity breakdown, and an issue-count or story-point
  measure. Forecasts label limited history; pivots remain count-based.
  (REEF-186, REEF-188, REEF-189, REEF-190)
- Portfolio health rolls up milestones, sprints, releases, and parent epics,
  with drill-down and optional inclusion of shipped items. (REEF-187, REEF-191)

### Changed

- Issue edits update affected cached rows and refresh views when membership,
  sorting, or dependencies change. The rich-text editor loads on demand.
  (REEF-098, REEF-220)
- Settings separates Workspace, Preferences, and Deployment into shareable
  pages, with General and Members under Workspace. (REEF-183)
- Reports consolidates priority and age into the risk map, clarifies the
  Throughput period scope, and standardizes accessible chart styling.
  (REEF-184, REEF-185, REEF-248)
- Search results support normal browser link actions and announce loading
  status. (REEF-221)
- Route and issue-detail loading placeholders match their content and respect
  reduced motion. (REEF-249, REEF-250, REEF-255)

### Fixed

- Opening an issue rereads current data. Concurrent document changes produce
  a retryable save conflict instead of overwriting them. (REEF-227)
- Issue details preserve the originating List, Timeline, or Backlog view,
  including filters and sort. Direct links still open over Board. (REEF-222)
- Page overscroll no longer moves the sidebar. Focus outlines remain visible
  across forms and sidebar controls. (REEF-172, REEF-226, REEF-254)
- Long planning selections remain readable in filters and Reports. (REEF-246)

### Migration

- `reef_comments` and `reef_activity` tables are created and schema-checked
  on workspace initialization or the first comment or activity write. No manual
  AKB migration is required. (REEF-062, REEF-063, REEF-125)
- Vault skill version 13 documents comments, activity, and issue-creation
  guards for parent links and status timestamps. Existing vaults must reinstall
  managed instructions from Settings before agents use those contracts.
  (REEF-126, REEF-224, REEF-252)
- Cache buster `reef-cache-v5` discards stale issue snapshots automatically.
  (REEF-098)

### Operational

- Production logs use JSON lines with credential redaction and trace IDs.
  Operators parsing stdout must accept JSON. (REEF-235)

## v0.4.0 - 2026-06-12

### Added

- AKB-delegated Keycloak SSO exchanges one-time codes server-side into the
  Reef session cookie. Password login remains available. (REEF-102)
- The sidebar includes an active-workspace switcher, workspace creation,
  account controls, sign-out, and theme selection. Sign-out clears account
  data while retaining device preferences. (REEF-068, REEF-095, REEF-146,
  REEF-147)
- Backlog is a separate issue stage and triage view. Backlog work stays out of
  the active board, timeline, and in-flight health metrics. (REEF-109)
- Parent issues show sub-issues with completion progress. (REEF-081)
- Board, List, and Backlog share sorting, including Points and Title. Manual
  backlog ordering works under filters and places new items at the tail.
  Cards and rows animate changes with reduced-motion support. (REEF-059,
  REEF-121, REEF-169, REEF-175, REEF-176)
- Issues can link AKB documents found by title, with open, copy, and remove
  actions. AI enrichment can suggest supporting documents. (REEF-083)
- Issue and planning editors share themed date pickers and a fuller Markdown
  toolbar. Date fields support Today, Clear, and typed ISO dates. (REEF-082,
  REEF-108, REEF-154)
- Workspaces can choose the authoring language for newly generated AI prose
  during creation or in Settings. Existing content is unchanged. (REEF-136,
  REEF-160)
- Settings reports workspace instruction drift and lets writers reinstall
  managed instructions, replacing manual edits after confirmation. (REEF-123)

### Changed

- New issues default to Backlog; AI drafts can derive a status from code
  signals. Backlog hides Sprint, Release, and Due filters. (REEF-130, REEF-177)
- Failed background saves offer retry, archives offer undo, and creation errors
  appear inline with focus on the first invalid field. (REEF-119)
- Settings separates team, personal, and deployment ownership. Team settings
  identify their active workspace and respect read-only roles. (REEF-020,
  REEF-174)
- Issue and report filters share planning and people pickers. Labels use chips,
  and the signed-in user's avatar uses a consistent color. (REEF-074, REEF-091,
  REEF-140, REEF-173)
- Ask AI can answer from AKB alone when GitHub grounding is unavailable.
  (REEF-089)
- Timeline opens around today and supports recentering. Global search queries
  all workspace issues and previews recent items when empty. (REEF-078,
  REEF-080)
- GitHub repository errors preserve permission status and ETag revalidation.
  (REEF-076)
- Issue details replace duplicate provenance with an edited timestamp.
  Obsolete `status=open` URL filters are ignored. (REEF-122, REEF-141)

### Fixed

- Markdown checklists render correctly, long descriptions scroll within the
  editor, and Source grows with its content. (REEF-133, REEF-157, REEF-161,
  REEF-164)
- Pickers stay within their viewport, preserve readable names, and close
  when their trigger is clicked again. Relationship suggestions accept mouse
  selections. (REEF-072, REEF-073, REEF-092, REEF-134, REEF-145)
- External references and scan-review evidence render as links. Approved
  status suggestions retain PR and commit evidence without duplicates.
  (REEF-087, REEF-138, REEF-156)
- Reports counts only unresolved dependencies as blockers or risks. (REEF-155)
- A failed row save compensates a document write to keep issue content and
  board fields consistent. (REEF-094)
- Issue forms keep long fields and references within their columns; close
  controls and board avatars remain aligned. (REEF-071, REEF-111, REEF-128,
  REEF-149, REEF-167)
- Workspace selection excludes uninitialized vaults. Missing GitHub
  configuration shows one unavailable hint instead of repeated errors.
  (REEF-143, REEF-159, REEF-244)
- Sidebar menus, Settings, and Planning improve keyboard and screen-reader
  behavior. Planning view state survives shared links and reloads.
  (REEF-151, REEF-152, REEF-168, REEF-171)

### Migration

- Issue status `open` was renamed to `todo`. The temporary read-side
  compatibility shim shipped (REEF-139) and was then removed within this same
  release (REEF-141), so it is no longer present. Each existing workspace must run
  a one-time backfill at or before deploy — `UPDATE reef_issues SET status='todo'
  WHERE status='open'` per vault — or any issue still stored as `open` drops out
  of the active board/list view. New writes already use `todo` (REEF-139,
  REEF-141).
- Planning tables now let akb own their `id` primary key. Existing vaults
  whose `reef_sprints` / `reef_milestones` / `reef_releases` predate this (e.g.
  `reef-test`) must run `docs/migrations/REEF-158-planning-uuid-id.sql` once per
  vault: back up the affected tables, run the script (a single transaction),
  confirm the verification query returns 0, then deploy the new build. It swaps
  the old text logical id (`spr-`/`mil-`/`rel-`) for akb's uuid and remaps
  `reef_issues.{sprint,milestone,release}_id` plus any pending
  activity-suggestion `meta`. Newly created vaults are uuid-native and need no
  migration (REEF-158).
- The Reef vault skill and AI runbooks were revised several times this
  release (people / backlog / sprint runbook rules, the authoring-language
  directive, the status-rename guidance, the planning-uuid workflow) and now
  stamp skill version 9. There is still no automatic re-sync for existing
  workspaces such as `reef-test`; update each one via the new Settings →
  Workspace AI Instructions panel (REEF-123) or manually with `akb_update`
  (REEF-123, REEF-136, REEF-139, REEF-148, REEF-158, REEF-166).
- Backlog manual-order ranks live in `reef_issues.rank`. New and demoted
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

- Establish repository-wide SemVer, the root package version, and the release
  and migration policies. CI enforces one version source and migration-note
  coverage while allowing an empty Unreleased section after a release cut.

### Migration

- Remove the test SQL migration from `deploy/migrations`. Reef does not own
  direct AKB database migrations; release notes document required compatibility
  and operator actions.
