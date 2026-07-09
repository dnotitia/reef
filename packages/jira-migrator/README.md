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
- Basic auth: `REEF_JIRA_EMAIL`/`JIRA_EMAIL` plus
  `REEF_JIRA_API_TOKEN`/`JIRA_API_TOKEN` or
  `REEF_JIRA_API_TOKEN_FILE`/`JIRA_API_TOKEN_FILE`
- Bearer auth: `REEF_JIRA_BEARER_TOKEN`/`JIRA_BEARER_TOKEN` or
  `REEF_JIRA_BEARER_TOKEN_FILE`/`JIRA_BEARER_TOKEN_FILE`

`publicJiraMigratorConfig` and `redactForConfig` are the only supported ways to
serialize config/report data; they omit or redact secret values.
