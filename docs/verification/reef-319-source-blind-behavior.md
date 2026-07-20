# REEF-319 Source-Blind Behavior Proof

This is the redacted, reviewable transcript for the REEF-319 local operator
artifact contract. The validator ran from a mode-`0700` private temporary
directory containing only the prewritten behavior contract, synthetic fixtures,
and the runner. It imported `packages/jira-migrator/dist/index.js`; it did not
receive repository source, diffs, tests, history, credentials, or private user
data.

The workspace's public `@reef/core` package intentionally exports TypeScript
source, so the built jira-migrator entrypoint was launched with the package's
normal `tsx` runtime loader. A direct plain-Node import is not a valid standalone
deployment shape for this private pnpm-workspace package.

## Contract

An operator can persist and resume a Jira migration without duplicate targets,
while invalid, drifted, locked, or secret-bearing local state fails closed.
The required observations were:

1. missing file -> empty v1 -> save -> disk reload;
2. unbound create -> confirmed target readback -> bound skip;
3. failed readback cannot create a binding;
4. retryable failure resumes at the entity while completed work is skipped;
5. input reversal yields the same resume set;
6. two project keys share one Cloud-scoped run and report from persisted state;
7. malformed JSON, unsupported version, source/target scope drift, run-plan
   drift, sibling lock, and configured secret material return typed safe errors.

## Reproduction

After `pnpm --filter @reef/jira-migrator run build`, run the prewritten contract
from a private temporary directory and point its runner at the built public
entrypoint:

```text
<jira-migrator package>/node_modules/.bin/tsx run.mjs \
  <repository>/packages/jira-migrator/dist/index.js
```

`run.mjs` is an isolated black-box fixture, not a repository test. It uses only
the exported API and generated local artifact files. The private temporary
directory is removed after the run.

## Redacted Result

```json
{
  "overall_behavior": "satisfies_contract",
  "target": {
    "type": "built public Node package",
    "access": "dist/index.js (local path redacted)"
  },
  "summary": { "pass": 12, "fail": 0, "blocked": 0 },
  "checks": [
    { "clause": "missing-save-reload", "status": "pass" },
    { "clause": "create-readback-skip", "status": "pass" },
    { "clause": "readback-binding-guard", "status": "pass", "code": "target_readback_required" },
    { "clause": "retry-resume-reorder", "status": "pass" },
    { "clause": "multi-project-report", "status": "pass" },
    { "clause": "run-plan-drift", "status": "pass", "code": "run_plan_conflict" },
    { "clause": "source-scope-drift", "status": "pass", "code": "source_scope_mismatch" },
    { "clause": "target-scope-drift", "status": "pass", "code": "target_scope_mismatch" },
    { "clause": "malformed-json", "status": "pass", "code": "malformed_json" },
    { "clause": "unsupported-version", "status": "pass", "code": "unsupported_schema_version" },
    { "clause": "sibling-lock", "status": "pass", "code": "lock_conflict" },
    { "clause": "configured-secret", "status": "pass", "code": "secret_material_detected" }
  ],
  "anti_cheat_probes": [
    "disk reload",
    "input reversal",
    "run fingerprint drift",
    "real sibling lock",
    "configured sentinel secret"
  ],
  "blockers": []
}
```

No secret value, raw Jira payload, upstream body, credential, cookie, private
user data, local-only URL, or temporary filesystem path is present in this
evidence.
