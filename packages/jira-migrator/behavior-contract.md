# REEF-320 Behavior Contract

## User-Visible Goal

An operator can inspect one Jira issue's comments, attachments/media, standard
links, and remote links in dry-run mode, apply them to an isolated Reef target,
and rerun the same input without duplicates.

## Target

- Type: exported Node package API.
- Access: import `importJiraRelatedData` from the built `@reef/jira-migrator`
  public entry point.
- Fixtures: synthetic Jira responses and an isolated in-memory Reef target.
- Credentials: synthetic placeholder only; no live service is used.

## Operator Tasks And Expected Behavior

1. Dry-run reports comment root/reply counts, attachment and media strategies,
   deduplicated links, remote links, and failures without target mutations.
2. Apply creates root-first threaded comments, attachment file/readback state,
   rewritten file URIs, configured relations, external refs, and ledger
   bindings.
3. Rerun leaves target counts unchanged and reports readback/skipped entities.
4. An orphan reply, ambiguous media, attachment size mismatch, or unknown link
   is isolated while sibling entities continue.

## Anti-Cheat Probes

- Change a fixture count and verify the aggregate report changes.
- Change a directional mapping to symmetric and verify the target relation
  changes.
- Verify every Jira request is GET, every comment page includes
  `expand=properties`, and attachment content includes `redirect=false`.

## Evidence Required

- Redacted public API invocation transcript.
- Before/dry-run/apply/rerun target counts.
- Redacted request method/path/query summary.
- Structured pass/fail report for every clause above.

## Out Of Scope

Project enumeration and final CLI orchestration, changelog history import, live
Jira writes, and shared/production Reef or AKB mutation.
