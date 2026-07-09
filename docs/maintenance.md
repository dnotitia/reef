# Maintenance

This document is the working manual for reef's codebase maintenance: how to scan
for cleanup candidates, what each scan result means, how to verify a finding
against the real code, and how to resolve it by category. A human can follow it
by hand.

This document is the source of truth for *what the work is* and *how each
finding is handled*. Any loop or automation that drives the work is just
following this manual. The maintenance scan is advisory, not a CI gate today.

## Goals

- Find and retire duplicated code, dead code, unused exports, deprecated API
  usage, oversized files with unclear boundaries, slow tests, and stale or
  over-broad code comments.
- Keep maintenance reviewable: make the smallest coherent change for each
  verified finding and record the verification that proves it.
- Preserve reef's architecture boundaries from `AGENTS.md` and package-local
  `AGENTS.md` files.
- Produce reports a human can read before accepting, suppressing, or promoting a
  check into CI.

## Non-goals

- Do not treat raw scanner output as truth. Every finding needs code-path
  verification before a deletion or refactor.
- Do not turn these checks into required CI gates until the false-positive set is
  understood and documented.
- Do not hide maintenance knowledge in tooling. Whatever automation runs the
  scan executes this manual; this document remains the repo-local source of
  truth.

## What "Done" Means

The work targets a state, not a number. Every candidate a scanner surfaces is
driven to one of three terminal states — `resolved`, `suppressed`, or
`needs-human` (defined under Terminal States). The work is done when no
non-terminal finding remains. The residue is the `needs-human` set: findings a
person must decide, handed off rather than abandoned.

## How To Scan

Run `pnpm run maintenance:scan` to collect the full advisory report. It writes to
`.maintenance/reports/<timestamp>/`, which git ignores. Run a single category with
`pnpm run maintenance:scan -- <category>`, naming a category from Resolving By
Category (`dead-code`, `comment-claims`, `maintenance-lint`, `duplicates`,
`large-files`, `slow-tests`).

Use `pnpm run maintenance:assert-clean` when you need an exit-code gate for the
current maintenance report. It writes a normal report plus `assert-clean.json`,
then exits non-zero if any scanner cannot run or any selected category still
reports candidates. Category-scoped assertions use the same option, for example
`pnpm run maintenance:scan -- dead-code --assert-clean`.

A scanner's exit code is advisory: a non-zero exit usually means it reported
findings, not that the scan failed. What each scan looks at, and what its output
means:

- **duplicates** (`jscpd`) — scans `.ts`/`.tsx` under every workspace package's
  `src/` directory for copy-paste blocks of at least 20 lines / 150 tokens.
  Output is clone groups: each group lists the two or more locations that share
  the same block.
- **dead-code** (`knip`) — reports unused exports, unused files, and unused
  dependencies across the workspace. Because reef packages are private,
  configured entry-file exports are checked too, not assumed public.
- **maintenance-lint** (`eslint` with the maintenance config) — React Compiler
  and hooks diagnostics plus `@typescript-eslint/no-deprecated`. Output is
  warnings grouped by rule; each points at a file and line.
- **large-files** — scans source, test, and maintenance script files for files
  under workspace package `src/` roots, package `tests/` roots, and `scripts/`
  over the repo's advisory line-count thresholds. Output is a list of files with
  their kind, line count, threshold, reasons, and suggested verification focus.
  A large file is a cohesion-review candidate, not an automatic refactor request.
- **slow-tests** (`vitest`) — runs every workspace package whose `test` script is
  Vitest-based and flags tests over a 300 ms threshold. Output is one
  `slow-tests-<package-dir>/vitest.json` report per package; the slow tests are
  the candidates.
- **comment-claims** — scans comments for high-risk claim patterns: absolute
  wording (always/never/only/must), lifecycle wording (forward-only/backward/
  reopen), deprecated/legacy markers, stale document references (FR123,
  architecture.md), TODO/FIXME debt, and Korean lifecycle wording under
  workspace package `src/` roots and `scripts/`. Output is candidate comments
  with the pattern they matched — a prompt to verify, never an automatic failure.

## Reading A Finding

Scanner output is a candidate, not a verdict. Before changing anything, confirm
the candidate against the real code path. The general method:

1. Open the owning code and find what the scanner pointed at.
2. Find who depends on it — in-repo consumers, tests, docs, scripts, workspace
   package imports, and package subpath entries such as `@reef/core/fields` and
   `@reef/core/status`, not just the defining file.
3. Decide whether the candidate is real, a false positive the scanner could not
   see through, or a question code cannot answer.

A finding is actionable until verification proves otherwise. Do not escalate a
candidate to `needs-human` just because it is large or outside what you are
working on right now; if the next step is ordinary verification and a likely
mechanical fix, it is still actionable work.

## Terminal States

Every finding ends in exactly one of these:

- `resolved` — code was changed or deleted, focused verification ran, and the
  finding is confirmed gone.
- `suppressed` — a known false positive or an intentional exported surface.
  Record the exact file, symbol or dependency, the consumer the scanner missed,
  and where the suppression lives.
- `needs-human` — code-path verification cannot answer a product, API, UX,
  ownership, or compatibility question. Record the affected surface, the
  conservative default, the concrete human decision needed, and the recommended
  next action.

`deferred` is **not** a terminal state. A real finding that is outside the
current processing order is not parked under a status — it stays actionable and
gets picked up when its category comes around. The only reasons a finding leaves
the work unchanged are `suppressed` (proven false) and `needs-human` (a person
must take it from here).

An attempted fix that fails verification is not `needs-human` by itself. Keep the
finding actionable, fix the regression, or report the run as blocked if tooling,
environment, or repeated verification failure prevents progress.

## Resolving By Category

Findings move toward the next executable cleanup. For each category, here is how
to resolve a verified finding and when to stop and ask a human instead.

### dead-code

Remove unused re-exports, make same-file-only exports file-local, delete truly
unused symbols, or suppress a documented scanner miss. Treat as `needs-human`
only when the symbol is tied to a schema, adapter, storage, UI, or product
contract that needs a separate decision.

Reef workspace packages are private. Do not treat an export as public API merely
because it sits in an entry file. The internal contract is that other workspace
packages, tests, scripts, CLIs, and subpath entries consume package exports; an
export with no verified in-repo consumer is an ordinary dead-code candidate. For
a package export:

1. Check direct in-repo consumers first.
2. If none, prefer the smallest cleanup: remove the export, make it file-local,
   or delete the symbol.
3. Suppress only with a documented intentional consumer the scanner cannot see —
   record the file, symbol, missed consumer, and suppression location.
4. `needs-human` when the change would alter a schema, adapter, CLI, runtime, or
   package boundary contract, change storage or wire semantics, or need a
   broader verification plan.

For a leaf export (exported directly from its defining file, not only re-exported
by a barrel), triage in order: same-file-only consumer → drop `export`; no
verified consumer → delete; scanner-missed consumer → suppress with specifics;
schema/adapter/storage/UI/product uncertainty → `needs-human`.

The Knip config should reflect this: enable entry-export reporting where a package
has no external public API, and use documented suppressions for intentionally
retained internal contracts.

### maintenance-lint

Group by rule family and fix the smallest coherent set. React Compiler and hook
findings are proactive cleanup: remove derived state, move impure render-time
reads behind stable inputs, rename refs the rules intentionally key on, or
restructure callbacks/effects with tests. Treat as `needs-human` only when a fix
would change user-visible interaction or requires a new state-synchronization
model.

### large-files

Treat a large-file finding as a cohesion review. The threshold only says "look
here"; it does not prove the file should be split. First classify the file as
source, test, or script, then identify whether it contains several separable
responsibilities with natural names and owners.

Resolve a verified finding by extracting the smallest coherent unit: a UI leaf,
hook, pure helper, parser/renderer helper, test fixture, repeated setup helper, or
script subroutine. Keep the original call path covered by focused tests. For test
files, prefer shared fixtures and scenario helpers before splitting assertions
across files. For scripts, prefer separating CLI parsing, scanning, rendering,
and orchestration when those roles are already distinct.

Do not split a file solely to satisfy the threshold. Suppress only after
verifying the file is intentionally cohesive, generated or vendored, or already
has a better local boundary than a new module would provide; record the path and
reason in the large-file suppression allowlist. Treat as `needs-human` when the
right boundary depends on product, UX, ownership, or compatibility intent that
code cannot answer.

### slow-tests

Treat slow files as performance work. Start with the slowest file; identify
whether time goes to repeated setup, fake timers, async waits, excess rendering,
or duplicated scaffolding; reduce the smallest bottleneck and re-run the profile.
Treat as `needs-human` only when improvement needs a broader test architecture
change.

### duplicates

Inspect clone groups and remove the smallest duplication that has one owner and
one semantic meaning. Extract a helper or shared fixture only when it clarifies
the code. Leave cross-domain clones where abstraction would blur product
concepts.

### comment-claims

Treat a comment as a claim about the code. A claim is debt when it is too broad,
stale, or true only for one path. For each candidate: identify the exact claim,
find the code path that should make it true, check tests or docs that prove
current behavior, then narrow the comment, delete it, add the missing guard, or
escalate. Treat as `needs-human` only when the claim depends on product or
architecture intent that code cannot answer.

Example: lifecycle comments must distinguish AI status suggestions from manual
issue edits. AI status-change suggestions are forward-only at approval time, but
direct row updates are last-write-wins, and manual reopen/backward movement is a
deliberate exception. A comment that says status can never move backward is
therefore too broad.

## How Findings Chain

Fixing one finding can change others, which is why a category is not done the
moment its visible list is empty — it is done when a fresh scan of that category
surfaces nothing new. How strongly a category chains:

- **dead-code** — strong. Deleting an export can make its only caller newly
  unused, which a fresh scan reveals. Expect several passes before it is dry.
- **duplicates** — medium. Removing one clone dissolves its group; rescan to
  confirm no new overlap was exposed.
- **maintenance-lint** — weak. Fixes are usually file-local.
- **large-files** — weak to medium. Extracting a helper can make a large file
  fall below the threshold, but it can also surface a newly large helper or test
  fixture that needs its own cohesion check.
- **slow-tests** — minimal. A faster file does not affect another.
- **comment-claims** — none. Comments are independent.

## Report Requirements

Every maintenance summary must include:

- whether the work converged (no non-terminal finding left), and the processed
  queue or explicit user limit applied;
- the exact report directory and scanner commands used;
- a changed-item list with the verification performed and the commit for each
  committed change, if commits were requested;
- current counts per scanner after the last rescan;
- remaining findings grouped by terminal state, not by tool;
- for every `suppressed` or `needs-human` finding, the affected files/symbols, why
  it was not changed, and the smallest next step;
- validation commands and whether they passed.

## Future CI Path

These checks may graduate in stages. Do not skip the advisory phase: `knip`,
`jscpd`, and typed linting all need repo-specific calibration before they are fair
gates.

1. Advisory reports only.
2. Baseline reports committed or uploaded as artifacts.
3. Regression-only CI checks that fail only on new findings.
4. Full CI gates for categories with low false-positive rates.
