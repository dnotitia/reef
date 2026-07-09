# @reef/jira-migrator

Operator-run package for one-shot Jira migrations into Reef. It is intentionally
outside `@reef/web`: Jira credentials are deployment/operator secrets, not user
state in the product runtime.

## Configuration

The package loads non-secret settings from CLI flags or environment variables,
and credentials only from environment variables or local secret files.

```bash
reef-jira-migrator \
  --jira-base-url https://example.atlassian.net \
  --project-key SHDEV \
  --vault reef-test \
  --dry-run
```

Environment variables:

- `REEF_JIRA_BASE_URL` or `JIRA_BASE_URL`
- `REEF_JIRA_CLOUD_ID` or `JIRA_CLOUD_ID` (optional; can derive the Atlassian
  API gateway base URL when no base URL is supplied)
- `REEF_JIRA_PROJECT_KEY` or `JIRA_PROJECT_KEY`
- `REEF_JIRA_MIGRATOR_VAULT`, `REEF_ORCHESTRATOR_VAULT`, or `REEF_VAULT`
- `REEF_JIRA_MIGRATOR_REPORT_PATH` (optional)
- `REEF_JIRA_ACCOUNT_MAPPING_PATH` (optional local account mapping artifact)
- Basic auth: `REEF_JIRA_EMAIL`/`JIRA_EMAIL` plus
  `REEF_JIRA_API_TOKEN`/`JIRA_API_TOKEN` or
  `REEF_JIRA_API_TOKEN_FILE`/`JIRA_API_TOKEN_FILE`
- Bearer auth: `REEF_JIRA_BEARER_TOKEN`/`JIRA_BEARER_TOKEN` or
  `REEF_JIRA_BEARER_TOKEN_FILE`/`JIRA_BEARER_TOKEN_FILE`

`publicJiraMigratorConfig` and `redactForConfig` are the only supported ways to
serialize config/report data; they omit or redact secret values.

## Jira Account Mapping

Jira Cloud issue payloads identify people by `accountId`. The migrator maps
those account ids to Reef actors in this order:

1. Operator overrides in the account mapping artifact.
2. Email-directory matches when Jira exposes an email address.
3. Existing artifact records from a previous migration scan.
4. A stable fallback actor, `jira:<accountId>`.

Pass a local JSON artifact path with either the CLI flag or environment
variable:

```bash
reef-jira-migrator \
  --jira-cloud-id cloud-abc \
  --project-key SHDEV \
  --vault reef-test \
  --account-mapping ./artifacts/jira-account-mapping.cloud-abc.json \
  --dry-run
```

```bash
export REEF_JIRA_ACCOUNT_MAPPING_PATH=./artifacts/jira-account-mapping.cloud-abc.json
```

The current CLI entrypoint validates and exposes this path in config output.
Migration drivers should load and write the artifact with the exported helpers:

```ts
import {
  collectJiraUserObservations,
  loadJiraAccountMappingArtifact,
  mapJiraIssueActors,
  upsertJiraAccountMappingArtifact,
  writeJiraAccountMappingArtifact,
} from "@reef/jira-migrator";
```

When the configured file is missing, `loadJiraAccountMappingArtifact` returns an
empty artifact for the requested Jira Cloud id. After a scan, write the updated
artifact back so operators can review account ids before import:

```json
{
  "version": 1,
  "jiraCloudId": "cloud-abc",
  "accounts": {
    "acct-reporter": {
      "accountId": "acct-reporter",
      "emailAddress": "requester@example.com",
      "displayName": "Requester",
      "active": true,
      "accountType": "atlassian",
      "actor": "jira:acct-reporter",
      "mappingStrategy": "fallback",
      "overrideReason": null,
      "firstSeenAt": "2026-07-09T08:00:00.000Z",
      "lastSeenAt": "2026-07-09T08:00:00.000Z",
      "projectKeys": ["SHDEV"]
    }
  },
  "overrides": {}
}
```

To override a fallback or email match, add an entry under `overrides` keyed by
the Jira account id:

```json
{
  "overrides": {
    "acct-reporter": {
      "actor": "reef-requester",
      "reason": "operator confirmed requester account"
    }
  }
}
```

On the next mapping pass, `acct-reporter` resolves to `reef-requester` with the
`override` strategy. Removing that override makes the account recalculate from
email-directory data or the stable `jira:<accountId>` fallback; stale override
records are not kept active.

Keep account mapping artifacts local to the migration run. They can contain
Jira account ids, display names, and email addresses, so do not commit them to
the repository or include them in issue bodies, logs, or PR descriptions.
