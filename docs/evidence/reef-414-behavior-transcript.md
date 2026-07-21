# REEF-414 source-blind behavior transcript

Validated on 2026-07-21 in an isolated temporary directory containing only the
behavior contract, bundled CLI, local AKB fixture, and rendered manifest. The
validator did not inspect implementation source during these runs. Credentials
below are sentinel-only and redacted.

## Public CLI: discovery, first apply, and second no-op

```text
first exit=0; second exit=0
counts={discovered:4, reef:3, rawSkipped:1, completed:3}
workspaces=reef-a:no_op, reef-b:no_op, reef-c:no_op; phases=[]
table creates after first=33; after second=33
tables={raw:0, reef-a:11, reef-b:11, reef-c:11}
```

## Preflight before mutation

```text
exit=1
report={ok:false, code:preflight_failed, completed:0, failure:{vault:reef-b}}
tableCreates=0; ensureStarts=0
```

## Partial failure and retry

```text
first exit=1; code=verification_failed; completed=1; failure=reef-b
first creates={reef-a:11, reef-b:0, reef-c:0}
retry exit=0; completed=3
retry creates={reef-a:11, reef-b:11, reef-c:11}
```

## Image and manifest

```text
image Node=v22.23.1
bundled_without_dev_dependencies=pass
image CLI exit=0; discovered=4; reef=3; rawSkipped=1; completed=3
manifest kind=Deployment; strategy=Recreate
init command=/app/schema-migrator/cli.mjs
reef-migration-secret appears only in the schema-migrate init container
no kind=Job
```

## Local wrapper and credential boundary

```text
failure exit=1; report={ok:false, code:migration_startup_failed}; web not spawned
success exit=0
child spawn args=--filter @reef/web dev
child migration key present=no
child non-secret account=reef-migrator
```

## Sentinel failure

```text
exit=1
report={ok:false, code:verification_failed, completed:0, failure:{vault:reef-a}}
exact sentinel in stdout/stderr/report/wrapper/child probe=absent
```

## Anti-cheat probes

```text
inventory +reef-d => discovered=5; reef=4; completed=4; reef-d named
failure moved to reef-c => creates={reef-a:11, reef-b:11, reef-c:0}
same state twice => no extra table creates
```

The fixed-phase replay clause is recorded as `out_of_scope` in the JSON report:
this release intentionally has an empty catalog, and its contract forbids adding
a concrete operation or schema-version increase solely to manufacture a live
phase. Focused runner/core tests provide the replay/checksum-conflict evidence.
