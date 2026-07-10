# Raw Archive Behavior Contract

## User-Visible Goal

An operator can preserve pre-validation Jira JSON in a private, verifiable local
archive and hand downstream migration stages an opaque reference without
exposing raw payloads or secrets in report-shaped output.

## Target

- Type: generated artifact and public Node.js package API
- Access: the built `@reef/jira-migrator` public exports in a private temporary
  directory
- Fixtures: synthetic Jira-shaped JSON only; a synthetic secret canary is
  supplied through `forbiddenSecretValues`

## User Tasks

1. Archive semantically identical objects with different key insertion order,
   retry the same entity, and archive the same payload in another run.
2. Change one entity's payload, reopen the archive in a new process, and read
   both old and current opaque references.
3. Archive issue, description ADF, changelog, watcher, and custom-field JSON
   containing numeric ids, unknown fields, ordered arrays, and a PII marker.
4. Verify the archive and inspect only its redacted tree and manifest summary.
5. Attempt object/manifest corruption, a concurrent lock, unsafe permissions,
   traversal-like identities, forbidden header metadata, and secret-canary
   storage.

## Expected Observable Behavior

- Equivalent JSON produces the same digest and object path; retrying leaves the
  manifest unchanged; another run reuses the content object.
- A changed payload appends a version and preserves readback of the old version.
  Entry ordering is deterministic.
- Raw-only fields, numeric ids, and array order survive new-process readback.
- Missing, changed, malformed, unsupported, locked, symlinked, or overly open
  artifacts return stable safe error codes and no payload.
- A configured secret or forbidden auth/cookie metadata is rejected before the
  archive root is created. The canary never appears in stdout, stderr, errors,
  manifest, or objects.
- PII remains only inside the private archive. Report-shaped output contains
  counts, kinds, opaque references, digests, verification state, and error codes.
- POSIX directories/files are `0700`/`0600`; traversal-like source identities do
  not become path components; repository `/artifacts/` is ignored.

## Anti-Cheat Probes

- Reverse object insertion order and archive entity call order.
- Reopen from a separate Node.js process and compare exact raw-only values.
- Mutate one byte, delete an object, alter manifest checksum/schema, create a
  lock, and loosen permissions independently.
- Search captured stdout/stderr and the artifact tree for the secret canary;
  search report-shaped output for the PII marker.

## Evidence Required

- Clause-by-clause pass/fail report from the built package API
- Redacted artifact tree containing only structural names/digests
- Manifest summary containing versions/counts/checksum, never payload or identity
- Stable failure-code list, POSIX mode summary, and canary/PII isolation results

## Out Of Scope

- Jira/HTTP wire-byte capture, ledger/report/runner wiring, Reef UI behavior,
  Windows ACL implementation beyond required acknowledgement, and physical media
  sanitization execution
